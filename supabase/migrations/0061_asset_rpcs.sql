-- ============================================================================
-- BT Store Management — asset operations (#91 §2.4)
--
--   1. ONE GATE PER TRANSITION, IN SQL. assert_asset_transition() is the whole
--      lifecycle table (§2.3); every RPC below routes through it, so no path can
--      invent a state change. `src/lib/asset.ts` mirrors it for the UI only.
--   2. STATUS AND CUSTODY MOVE TOGETHER. close_open_custody() is the single
--      place that writes `returned_on`, and every status change out of `assigned`
--      calls it. That is what keeps 0060's two check constraints satisfiable.
--   3. RETIRING IS AN ADMIN ACT, LIKE DELETING. `retired` is terminal and takes
--      an asset out of service for good, so it is gated on `assets.delete`
--      alongside the soft delete — the same reasoning that keeps `*.delete` out
--      of every preset below Admin. Lost and Damaged are operational facts a
--      Manager reports, so they need only `assets.edit`.
--   4. MAINTENANCE HAS ONE WRITER FOR THE SERVICE DATES. save_asset_maintenance
--      may set `next_service_date` (so a schedule can exist before any job is
--      done) and close_asset_maintenance sets `last_service_date`. save_asset
--      never touches either — a second writer would let the register and the
--      service history disagree.
--   5. TAKING AN ASSET OUT OF SERVICE IS PART OF OPENING THE JOB, not a separate
--      call: `takeOutOfService` on save_asset_maintenance sends it to
--      `under_repair` (repair) or `maintenance` (service/AMC). An AMC record for
--      a machine that is still in use simply leaves the flag off.
--   6. NOTHING HERE MOVES MONEY. A repair cost is recorded on the maintenance
--      record for the Maintenance Report; the cash side of it is an expense, and
--      the expense module (0051/0052) already owns that path. Posting here would
--      double-count the spend.
--
-- Applies on top of 0060.
-- ============================================================================

-- ─── The lifecycle table (note 1) ───────────────────────────────────────────
-- `lost` and `retired` are terminal (§2.3). `damaged` is not: a damaged asset is
-- routinely repaired or written off, so it keeps its exits.
create or replace function public.assert_asset_transition(p_from text, p_to text)
returns void language plpgsql immutable as $$
begin
  if p_from = p_to then return; end if;

  if not (
    case p_from
      when 'available'    then p_to in ('assigned','under_repair','maintenance',
                                        'lost','damaged','retired')
      when 'assigned'     then p_to in ('available','under_repair','maintenance',
                                        'lost','damaged','retired')
      when 'under_repair' then p_to in ('available','maintenance',
                                        'lost','damaged','retired')
      when 'maintenance'  then p_to in ('available','under_repair',
                                        'lost','damaged','retired')
      when 'damaged'      then p_to in ('available','under_repair','lost','retired')
      else false  -- lost and retired are terminal
    end
  ) then
    raise exception 'an asset that is % cannot become %', p_from, p_to;
  end if;
end $$;

-- ─── Internal: the only writer of history, so no path can skip it ───────────
create or replace function public.log_asset_event(
  p_asset_id uuid, p_event text, p_detail jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.asset_event (asset_id, event, actor, detail)
    values (p_asset_id, p_event, auth.uid(), coalesce(p_detail, '{}'::jsonb));
end $$;

revoke execute on function public.log_asset_event(uuid, text, jsonb) from public;

-- ─── Internal: the only writer of `returned_on` (note 2) ────────────────────
-- Returns the id of the row it closed, or null when the asset was not out.
create or replace function public.close_open_custody(
  p_asset_id uuid, p_on date, p_remarks text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_from date;
begin
  select id, assigned_on into v_id, v_from
    from public.asset_assignment
   where asset_id = p_asset_id and returned_on is null
     for update;
  if v_id is null then return null; end if;

  -- The custody trail has to stay chronological, and 0060's check constraint
  -- would reject this anyway — catch it with a sentence a person can act on.
  if p_on < v_from then
    raise exception 'this asset was issued on %, so it cannot come back on %',
      v_from, p_on;
  end if;

  update public.asset_assignment
     set returned_on = p_on,
         return_remarks = btrim(coalesce(p_remarks, ''))
   where id = v_id;

  return v_id;
end $$;

revoke execute on function public.close_open_custody(uuid, date, text) from public;

-- ─── Internal: status change + the custody it implies (notes 2, 3) ──────────
create or replace function public.move_asset_status(
  p_id uuid, p_to text, p_on date, p_note text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare a public.asset; v_closed uuid;
begin
  select * into a from public.asset where id = p_id for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;

  perform public.assert_asset_transition(a.status, p_to);
  if a.status = p_to then return; end if;

  -- Note 2: leaving `assigned` always closes the open row rather than orphaning it.
  if a.status = 'assigned' then
    v_closed := public.close_open_custody(p_id, p_on,
      case when btrim(coalesce(p_note,'')) <> '' then p_note
           else 'Closed on status change to ' || p_to end);
  end if;

  update public.asset
     set status = p_to,
         assigned_to = case when p_to = 'assigned' then a.assigned_to else null end,
         updated_by = auth.uid()
   where id = p_id;

  perform public.log_asset_event(p_id, 'status_changed',
    jsonb_build_object('from', a.status, 'to', p_to, 'on', p_on,
                       'note', btrim(coalesce(p_note,'')),
                       'closedAssignment', v_closed));

  insert into public.activity_log (type, actor, item_name, notes)
    values ('asset', auth.uid(), a.name,
            a.code || ': ' || a.status || ' → ' || p_to
            || case when btrim(coalesce(p_note,'')) <> ''
                    then ' — ' || btrim(p_note) else '' end);
end $$;

revoke execute on function public.move_asset_status(uuid, text, date, text) from public;

-- ─── save_asset: create or edit the register entry ───────────────────────────
-- Deliberately cannot write `status`, `assigned_to`, `last_service_date` or
-- `next_service_date` (notes 1 and 4).
create or replace function public.save_asset(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_old public.asset;
  v_name text := btrim(coalesce(p->>'name',''));
  v_cat  text := btrim(coalesce(p->>'category',''));
  v_serial text := btrim(coalesce(p->>'serialNumber',''));
  v_location text := btrim(coalesce(p->>'location',''));
  v_purchased date := nullif(p->>'purchaseDate','')::date;
  v_price numeric := round(coalesce((p->>'purchasePrice')::numeric, 0), 2);
  v_vendor uuid := nullif(p->>'vendorId','')::uuid;
  v_wstart date := nullif(p->>'warrantyStart','')::date;
  v_wend date := nullif(p->>'warrantyExpiry','')::date;
  v_condition text := coalesce(p->>'condition','');
  v_docs jsonb := coalesce(p->'documents', '[]'::jsonb);
  v_diff jsonb := '{}'::jsonb;
begin
  if v_id is null then
    if not public.has_perm('assets.create') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('assets.edit') then raise exception 'forbidden'; end if;
  end if;

  -- ── Validation ───────────────────────────────────────────────────────────
  if v_name = '' then raise exception 'an asset needs a name'; end if;
  if v_location = '' then raise exception 'where is this asset kept?'; end if;
  if v_purchased is null then raise exception 'when was this bought?'; end if;
  if v_purchased > public.store_today() then
    raise exception 'a purchase date cannot be in the future';
  end if;
  if v_price < 0 then raise exception 'a purchase price cannot be negative'; end if;
  if v_condition not in ('','new','good','fair','poor') then
    raise exception 'unknown condition "%"', v_condition;
  end if;
  if jsonb_typeof(v_docs) <> 'array' then
    raise exception 'documents must be a list';
  end if;

  -- Note 5 of 0060: the category list is admin-managed, so an unknown value is
  -- a typo rather than a new category.
  if not exists (select 1 from public.store_lists
                  where kind = 'asset_category' and value = v_cat) then
    raise exception 'choose an asset category';
  end if;

  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;

  if v_wstart is not null and v_wend is not null and v_wend < v_wstart then
    raise exception 'the warranty cannot end before it starts';
  end if;
  if v_wend is not null and v_wend < v_purchased then
    raise exception 'the warranty cannot end before the asset was bought';
  end if;

  -- §2.2: unique if provided. Checked here so the message is readable rather
  -- than a unique-index violation.
  if v_serial <> '' and exists (
    select 1 from public.asset
     where lower(btrim(serial_number)) = lower(v_serial)
       and deleted_at is null
       and (v_id is null or id <> v_id)
  ) then
    raise exception 'serial number "%" is already registered', v_serial;
  end if;

  -- ── Edit ─────────────────────────────────────────────────────────────────
  if v_id is not null then
    select * into v_old from public.asset where id = v_id for update;
    if not found or v_old.deleted_at is not null then
      raise exception 'asset not found';
    end if;
    if v_old.status in ('lost','retired') then
      raise exception 'a % asset is history and cannot be edited', v_old.status;
    end if;

    -- A field-level diff, so the timeline can say what actually changed.
    if v_old.name <> v_name then
      v_diff := v_diff || jsonb_build_object('name',
        jsonb_build_array(v_old.name, v_name)); end if;
    if v_old.category <> v_cat then
      v_diff := v_diff || jsonb_build_object('category',
        jsonb_build_array(v_old.category, v_cat)); end if;
    if v_old.serial_number <> v_serial then
      v_diff := v_diff || jsonb_build_object('serialNumber',
        jsonb_build_array(v_old.serial_number, v_serial)); end if;
    if v_old.location <> v_location then
      v_diff := v_diff || jsonb_build_object('location',
        jsonb_build_array(v_old.location, v_location)); end if;
    if v_old.department <> btrim(coalesce(p->>'department','')) then
      v_diff := v_diff || jsonb_build_object('department',
        jsonb_build_array(v_old.department, btrim(coalesce(p->>'department','')))); end if;
    if v_old.purchase_date <> v_purchased then
      v_diff := v_diff || jsonb_build_object('purchaseDate',
        jsonb_build_array(v_old.purchase_date, v_purchased)); end if;
    if v_old.purchase_price <> v_price then
      v_diff := v_diff || jsonb_build_object('purchasePrice',
        jsonb_build_array(v_old.purchase_price, v_price)); end if;
    if v_old.condition <> v_condition then
      v_diff := v_diff || jsonb_build_object('condition',
        jsonb_build_array(v_old.condition, v_condition)); end if;
    if v_old.vendor_id is distinct from v_vendor then
      v_diff := v_diff || jsonb_build_object('vendorId',
        jsonb_build_array(v_old.vendor_id, v_vendor)); end if;
    if v_old.warranty_expiry is distinct from v_wend then
      v_diff := v_diff || jsonb_build_object('warrantyExpiry',
        jsonb_build_array(v_old.warranty_expiry, v_wend)); end if;

    update public.asset set
      name = v_name, category = v_cat,
      brand = btrim(coalesce(p->>'brand','')),
      model = btrim(coalesce(p->>'model','')),
      serial_number = v_serial,
      purchase_date = v_purchased, purchase_price = v_price,
      vendor_id = v_vendor,
      warranty_start = v_wstart, warranty_expiry = v_wend,
      location = v_location,
      department = btrim(coalesce(p->>'department','')),
      condition = v_condition,
      notes = btrim(coalesce(p->>'notes','')),
      image_url = nullif(btrim(coalesce(p->>'imageUrl','')), ''),
      documents = v_docs,
      updated_by = auth.uid()
    where id = v_id;

    -- A save that changed nothing is not history worth recording.
    if v_diff <> '{}'::jsonb then
      perform public.log_asset_event(v_id, 'edited', v_diff);
      insert into public.activity_log (type, actor, item_name, total, notes)
        values ('asset', auth.uid(), v_name, v_price,
                'Edited asset ' || v_old.code);
    end if;

    return v_id;
  end if;

  -- ── Create: always lands as `available` (§2.4) ────────────────────────────
  insert into public.asset (
    name, category, brand, model, serial_number,
    purchase_date, purchase_price, vendor_id,
    warranty_start, warranty_expiry,
    location, department, condition, notes, image_url, documents,
    status, created_by, updated_by)
  values (
    v_name, v_cat,
    btrim(coalesce(p->>'brand','')), btrim(coalesce(p->>'model','')), v_serial,
    v_purchased, v_price, v_vendor,
    v_wstart, v_wend,
    v_location, btrim(coalesce(p->>'department','')), v_condition,
    btrim(coalesce(p->>'notes','')),
    nullif(btrim(coalesce(p->>'imageUrl','')), ''), v_docs,
    'available', auth.uid(), auth.uid())
  returning id into v_id;

  perform public.log_asset_event(v_id, 'created',
    jsonb_build_object('name', v_name, 'category', v_cat, 'price', v_price));

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('asset', auth.uid(), v_name, v_price,
            'Added asset ' || (select code from public.asset where id = v_id)
            || ' (' || v_cat || ')');

  return v_id;
end $$;

-- ─── Archive / restore: out of the active list, still not deleted (§2.4) ────
create or replace function public.archive_asset(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare a public.asset;
begin
  if not public.has_perm('assets.edit') then raise exception 'forbidden'; end if;

  select * into a from public.asset where id = p_id for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;

  if p_archived and a.status = 'assigned' then
    raise exception 'this asset is with % — take it back before archiving it',
      coalesce((select name from public.profiles where id = a.assigned_to), 'someone');
  end if;

  update public.asset
     set archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then auth.uid() else null end,
         updated_by = auth.uid()
   where id = p_id;

  perform public.log_asset_event(p_id,
    case when p_archived then 'archived' else 'restored' end, '{}'::jsonb);

  insert into public.activity_log (type, actor, item_name, notes)
    values ('asset', auth.uid(), a.name,
            case when p_archived then 'Archived asset ' else 'Restored asset ' end
            || a.code);
end $$;

-- ─── delete: soft, always (§7 — no hard deletes in this module) ─────────────
create or replace function public.delete_asset(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.asset;
begin
  if not public.has_perm('assets.delete') then raise exception 'forbidden'; end if;

  select * into a from public.asset where id = p_id for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;
  if a.status = 'assigned' then
    raise exception 'this asset is still with someone — take it back first';
  end if;
  if exists (select 1 from public.asset_maintenance
              where asset_id = p_id and status = 'open') then
    raise exception 'this asset is in the workshop — close the job first';
  end if;

  update public.asset
     set deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid()
   where id = p_id;

  perform public.log_asset_event(p_id, 'deleted', '{}'::jsonb);

  insert into public.activity_log (type, actor, item_name, notes)
    values ('asset', auth.uid(), a.name, 'Removed asset ' || a.code);
end $$;

-- ─── assign / return / transfer (§2.4, §2.5) ────────────────────────────────
create or replace function public.assign_asset(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a public.asset;
  v_asset uuid := nullif(p->>'assetId','')::uuid;
  v_emp uuid := nullif(p->>'employeeId','')::uuid;
  v_on date := coalesce(nullif(p->>'assignedOn','')::date, public.store_today());
  v_recv uuid := nullif(p->>'receivedById','')::uuid;
  v_dept text := btrim(coalesce(p->>'department',''));
  v_id uuid;
begin
  if not public.has_perm('assets.assign') then raise exception 'forbidden'; end if;

  select * into a from public.asset where id = v_asset for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;
  if a.archived_at is not null then
    raise exception 'this asset is archived — restore it before issuing it';
  end if;
  if a.status = 'assigned' then
    raise exception 'this asset is already with % — transfer it instead',
      coalesce((select name from public.profiles where id = a.assigned_to), 'someone');
  end if;
  perform public.assert_asset_transition(a.status, 'assigned');

  if v_emp is null or not exists (select 1 from public.profiles where id = v_emp) then
    raise exception 'who is this asset going to?';
  end if;
  if v_on > public.store_today() then
    raise exception 'an assignment date cannot be in the future';
  end if;
  if v_on < a.purchase_date then
    raise exception 'this asset was bought on %, so it cannot be issued on %',
      a.purchase_date, v_on;
  end if;

  -- The department snapshot falls back to the asset's own (0060 note 6).
  insert into public.asset_assignment (
    asset_id, employee_id, department, assigned_on,
    assigned_by, received_by, remarks, signature_url)
  values (
    v_asset, v_emp, coalesce(nullif(v_dept, ''), a.department), v_on,
    auth.uid(), v_recv, btrim(coalesce(p->>'remarks','')),
    nullif(btrim(coalesce(p->>'signatureUrl','')), ''))
  returning id into v_id;

  update public.asset
     set status = 'assigned', assigned_to = v_emp, updated_by = auth.uid()
   where id = v_asset;

  perform public.log_asset_event(v_asset, 'assigned',
    jsonb_build_object('assignmentId', v_id, 'employeeId', v_emp, 'on', v_on));

  insert into public.activity_log (type, actor, item_name, notes)
    values ('asset', auth.uid(), a.name,
            'Issued ' || a.code || ' to '
            || coalesce((select name from public.profiles where id = v_emp), 'staff'));

  return v_id;
end $$;

create or replace function public.return_asset(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.asset;
  v_asset uuid := nullif(p->>'assetId','')::uuid;
  v_on date := coalesce(nullif(p->>'returnedOn','')::date, public.store_today());
  v_cond text := coalesce(p->>'condition', '');
  v_closed uuid;
begin
  if not public.has_perm('assets.assign') then raise exception 'forbidden'; end if;

  select * into a from public.asset where id = v_asset for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;
  if a.status <> 'assigned' then
    raise exception 'this asset is not out with anyone';
  end if;
  if v_on > public.store_today() then
    raise exception 'a return date cannot be in the future';
  end if;
  if v_cond not in ('','new','good','fair','poor') then
    raise exception 'unknown condition "%"', v_cond;
  end if;

  v_closed := public.close_open_custody(v_asset, v_on,
    btrim(coalesce(p->>'returnRemarks','')));

  update public.asset
     set status = 'available', assigned_to = null,
         condition = case when v_cond <> '' then v_cond else condition end,
         updated_by = auth.uid()
   where id = v_asset;

  perform public.log_asset_event(v_asset, 'returned',
    jsonb_build_object('assignmentId', v_closed, 'on', v_on,
                       'condition', nullif(v_cond, '')));

  insert into public.activity_log (type, actor, item_name, notes)
    values ('asset', auth.uid(), a.name,
            'Took back ' || a.code || ' from '
            || coalesce((select name from public.profiles where id = a.assigned_to), 'staff'));
end $$;

-- One action, two custody rows: the old one closes and the new one opens on the
-- same date, so the trail has no gap and no overlap (§2.4).
create or replace function public.transfer_asset(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a public.asset;
  v_asset uuid := nullif(p->>'assetId','')::uuid;
  v_emp uuid := nullif(p->>'employeeId','')::uuid;
  v_on date := coalesce(nullif(p->>'onDate','')::date, public.store_today());
  v_dept text := btrim(coalesce(p->>'department',''));
  v_closed uuid; v_id uuid; v_prev uuid;
begin
  if not public.has_perm('assets.assign') then raise exception 'forbidden'; end if;

  select * into a from public.asset where id = v_asset for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;
  if a.status <> 'assigned' then
    raise exception 'this asset is not out with anyone — issue it instead';
  end if;
  if v_emp is null or not exists (select 1 from public.profiles where id = v_emp) then
    raise exception 'who is this asset going to?';
  end if;
  if v_emp = a.assigned_to then
    raise exception 'this asset is already with that person';
  end if;
  if v_on > public.store_today() then
    raise exception 'a transfer date cannot be in the future';
  end if;

  v_prev := a.assigned_to;
  v_closed := public.close_open_custody(v_asset, v_on,
    btrim(coalesce(p->>'remarks','')));

  insert into public.asset_assignment (
    asset_id, employee_id, department, assigned_on,
    assigned_by, received_by, remarks, signature_url)
  values (
    v_asset, v_emp, coalesce(nullif(v_dept, ''), a.department), v_on,
    auth.uid(), nullif(p->>'receivedById','')::uuid,
    btrim(coalesce(p->>'remarks','')),
    nullif(btrim(coalesce(p->>'signatureUrl','')), ''))
  returning id into v_id;

  update public.asset
     set assigned_to = v_emp, updated_by = auth.uid()
   where id = v_asset;

  perform public.log_asset_event(v_asset, 'transferred',
    jsonb_build_object('from', v_prev, 'to', v_emp, 'on', v_on,
                       'closedAssignment', v_closed, 'assignmentId', v_id));

  insert into public.activity_log (type, actor, item_name, notes)
    values ('asset', auth.uid(), a.name,
            'Transferred ' || a.code || ' from '
            || coalesce((select name from public.profiles where id = v_prev), 'staff')
            || ' to '
            || coalesce((select name from public.profiles where id = v_emp), 'staff'));

  return v_id;
end $$;

-- ─── Mark lost / damaged / retired, and bring back to available ─────────────
-- Note 3: retiring is gated like deleting; the operational states are not.
create or replace function public.set_asset_status(
  p_id uuid, p_status text, p_note text default '', p_on date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_on date := coalesce(p_on, public.store_today());
begin
  if p_status not in ('available','lost','damaged','retired') then
    raise exception 'use the repair or assignment actions for "%"', p_status;
  end if;

  if p_status = 'retired' then
    if not public.has_perm('assets.delete') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('assets.edit') then raise exception 'forbidden'; end if;
  end if;

  if p_status in ('lost','damaged') and btrim(coalesce(p_note,'')) = '' then
    raise exception 'say what happened to this asset';
  end if;
  if v_on > public.store_today() then
    raise exception 'that date is in the future';
  end if;

  perform public.move_asset_status(p_id, p_status, v_on, p_note);
end $$;

-- ─── Maintenance (§2.6) ─────────────────────────────────────────────────────
-- Notes 4, 5 and 6: this opens or edits the job, may take the asset out of
-- service, may set the next service date, and never touches cash.
create or replace function public.save_asset_maintenance(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a public.asset;
  v_id uuid := nullif(p->>'id','')::uuid;
  v_old public.asset_maintenance;
  v_asset uuid := nullif(p->>'assetId','')::uuid;
  v_kind text := coalesce(p->>'kind','');
  v_vendor uuid := nullif(p->>'vendorId','')::uuid;
  v_started date := coalesce(nullif(p->>'startedOn','')::date, public.store_today());
  v_sched date := nullif(p->>'scheduledOn','')::date;
  v_next date := nullif(p->>'nextServiceOn','')::date;
  v_cost numeric := round(coalesce((p->>'cost')::numeric, 0), 2);
  v_amc_start date := nullif(p->>'amcStart','')::date;
  v_amc_end date := nullif(p->>'amcEnd','')::date;
  v_out boolean := coalesce((p->>'takeOutOfService')::boolean, false);
begin
  if not public.has_perm('assets.maintain') then raise exception 'forbidden'; end if;

  if v_kind not in ('repair','service','amc') then
    raise exception 'is this a repair, a service or an AMC?';
  end if;
  if v_cost < 0 then raise exception 'a cost cannot be negative'; end if;
  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;
  if v_amc_start is not null and v_amc_end is not null and v_amc_end < v_amc_start then
    raise exception 'an AMC cannot end before it starts';
  end if;

  -- ── Edit an existing job ─────────────────────────────────────────────────
  if v_id is not null then
    select * into v_old from public.asset_maintenance where id = v_id for update;
    if not found then raise exception 'maintenance record not found'; end if;
    if v_old.status = 'closed' then
      raise exception 'this job is closed — its history cannot be rewritten';
    end if;

    update public.asset_maintenance set
      kind = v_kind, vendor_id = v_vendor,
      scheduled_on = v_sched, started_on = v_started,
      cost = v_cost,
      amc_start = v_amc_start, amc_end = v_amc_end,
      amc_ref = btrim(coalesce(p->>'amcRef','')),
      next_service_on = v_next,
      notes = btrim(coalesce(p->>'notes','')),
      updated_by = auth.uid()
    where id = v_id;

    -- Note 4: a schedule can exist before any job is finished.
    if v_next is not null then
      update public.asset set next_service_date = v_next, updated_by = auth.uid()
       where id = v_old.asset_id;
    end if;

    perform public.log_asset_event(v_old.asset_id, 'maintenance_opened',
      jsonb_build_object('maintenanceId', v_id, 'kind', v_kind, 'edited', true));

    return v_id;
  end if;

  -- ── Open a new job ───────────────────────────────────────────────────────
  select * into a from public.asset where id = v_asset for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;
  if a.status in ('lost','retired') then
    raise exception 'a % asset cannot be serviced', a.status;
  end if;
  if exists (select 1 from public.asset_maintenance
              where asset_id = v_asset and status = 'open') then
    raise exception 'this asset already has an open job — close that one first';
  end if;
  if v_started > public.store_today() then
    raise exception 'a job cannot have started in the future';
  end if;

  insert into public.asset_maintenance (
    asset_id, kind, status, vendor_id, scheduled_on, started_on,
    cost, amc_start, amc_end, amc_ref, next_service_on, notes,
    created_by, updated_by)
  values (
    v_asset, v_kind, 'open', v_vendor, v_sched, v_started,
    v_cost, v_amc_start, v_amc_end, btrim(coalesce(p->>'amcRef','')),
    v_next, btrim(coalesce(p->>'notes','')), auth.uid(), auth.uid())
  returning id into v_id;

  if v_next is not null then
    update public.asset set next_service_date = v_next, updated_by = auth.uid()
     where id = v_asset;
  end if;

  perform public.log_asset_event(v_asset, 'maintenance_opened',
    jsonb_build_object('maintenanceId', v_id, 'kind', v_kind,
                       'startedOn', v_started, 'tookOutOfService', v_out));

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('asset', auth.uid(), a.name, v_cost,
            'Opened ' || v_kind || ' job on ' || a.code);

  -- Note 5: the status change is part of opening the job, and it closes any
  -- open custody row on the way (move_asset_status → close_open_custody).
  if v_out then
    perform public.move_asset_status(v_asset,
      case when v_kind = 'repair' then 'under_repair' else 'maintenance' end,
      v_started, 'Sent for ' || v_kind);
  end if;

  return v_id;
end $$;

-- Closing the job is what sets last_service_date (note 4) and what brings the
-- asset back into service. `toStatus` allows the other honest outcomes: a machine
-- that came back broken is `damaged`, one beyond repair is `retired`.
create or replace function public.close_asset_maintenance(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.asset_maintenance;
  a public.asset;
  v_id uuid := nullif(p->>'id','')::uuid;
  v_completed date := coalesce(nullif(p->>'completedOn','')::date, public.store_today());
  v_cost numeric := round(coalesce((p->>'cost')::numeric, 0), 2);
  v_next date := nullif(p->>'nextServiceOn','')::date;
  v_to text := coalesce(nullif(p->>'toStatus',''), 'available');
begin
  if not public.has_perm('assets.maintain') then raise exception 'forbidden'; end if;

  select * into m from public.asset_maintenance where id = v_id for update;
  if not found then raise exception 'maintenance record not found'; end if;
  if m.status = 'closed' then raise exception 'this job is already closed'; end if;

  select * into a from public.asset where id = m.asset_id for update;
  if not found or a.deleted_at is not null then raise exception 'asset not found'; end if;

  if v_completed < m.started_on then
    raise exception 'this job started on %, so it cannot have finished on %',
      m.started_on, v_completed;
  end if;
  if v_completed > public.store_today() then
    raise exception 'a completion date cannot be in the future';
  end if;
  if v_cost < 0 then raise exception 'a cost cannot be negative'; end if;
  if v_to not in ('available','damaged','retired') then
    raise exception 'a closed job leaves an asset available, damaged or retired';
  end if;
  -- Note 3: retiring stays an Admin act even on this path.
  if v_to = 'retired' and not public.has_perm('assets.delete') then
    raise exception 'forbidden';
  end if;
  if v_next is not null and v_next < v_completed then
    raise exception 'the next service cannot be due before this one finished';
  end if;

  update public.asset_maintenance
     set status = 'closed', completed_on = v_completed,
         cost = v_cost,
         next_service_on = coalesce(v_next, next_service_on),
         notes = case when btrim(coalesce(p->>'notes','')) <> ''
                      then btrim(p->>'notes') else notes end,
         updated_by = auth.uid()
   where id = v_id;

  -- Note 4: the single writer of last_service_date.
  update public.asset
     set last_service_date = v_completed,
         next_service_date = coalesce(v_next, m.next_service_on, next_service_date),
         updated_by = auth.uid()
   where id = m.asset_id;

  perform public.log_asset_event(m.asset_id, 'maintenance_closed',
    jsonb_build_object('maintenanceId', v_id, 'completedOn', v_completed,
                       'cost', v_cost, 'toStatus', v_to));

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('asset', auth.uid(), a.name, v_cost,
            'Closed ' || m.kind || ' job on ' || a.code
            || ' — ' || v_cost::text);

  -- An asset that never left service (an AMC record, say) stays where it is.
  if a.status in ('under_repair','maintenance') or v_to <> 'available' then
    perform public.move_asset_status(m.asset_id, v_to, v_completed,
      'Job closed: ' || m.kind);
  end if;
end $$;

-- ─── Who an asset can be issued to ──────────────────────────────────────────
-- Not `attendance_roster()`: that one is gated on attendance.view (employee
-- records are confidential) and excludes the Owner, who is not someone whose
-- attendance is marked. Both are wrong here — the Owner's own laptop is an asset,
-- and holding assets.assign should not require access to attendance.
create or replace function public.asset_holders()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name
  from public.profiles p
  where public.has_perm('assets.view')
  order by p.name
$$;

-- ─── Dashboard widgets (§4.1) ───────────────────────────────────────────────
-- One round trip for the whole tile row. `p_days` is the horizon for "due" and
-- "expiring", measured against the store's calendar, not the browser's.
create or replace function public.asset_stats(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with scope as (
    select * from public.asset
     where deleted_at is null and public.has_perm('assets.view')
  )
  select jsonb_build_object(
    'total',            (select count(*) from scope where archived_at is null),
    'available',        (select count(*) from scope where status = 'available'),
    'assigned',         (select count(*) from scope where status = 'assigned'),
    'underRepair',      (select count(*) from scope where status = 'under_repair'),
    'maintenance',      (select count(*) from scope where status = 'maintenance'),
    'lost',             (select count(*) from scope where status = 'lost'),
    'damaged',          (select count(*) from scope where status = 'damaged'),
    'retired',          (select count(*) from scope where status = 'retired'),
    'archived',         (select count(*) from scope where archived_at is not null),
    'maintenanceDue',   (select count(*) from scope
                          where next_service_date is not null
                            and next_service_date <= public.store_today() + p_days),
    'warrantyExpiring', (select count(*) from scope
                          where warranty_expiry is not null
                            and warranty_expiry >= public.store_today()
                            and warranty_expiry <= public.store_today() + p_days),
    'warrantyExpired',  (select count(*) from scope
                          where warranty_expiry is not null
                            and warranty_expiry < public.store_today()
                            and status not in ('retired','lost')),
    'totalValue',       (select coalesce(sum(purchase_price), 0) from scope
                          where status <> 'retired'),
    'repairCostMonth',  (select coalesce(sum(m.cost), 0)
                           from public.asset_maintenance m
                           join scope s on s.id = m.asset_id
                          where m.status = 'closed'
                            and m.completed_on >= date_trunc('month',
                                  public.store_today())::date)
  )
$$;

grant execute on function public.assert_asset_transition(text, text) to authenticated;
grant execute on function public.save_asset(jsonb) to authenticated;
grant execute on function public.archive_asset(uuid, boolean) to authenticated;
grant execute on function public.delete_asset(uuid) to authenticated;
grant execute on function public.assign_asset(jsonb) to authenticated;
grant execute on function public.return_asset(jsonb) to authenticated;
grant execute on function public.transfer_asset(jsonb) to authenticated;
grant execute on function public.set_asset_status(uuid, text, text, date) to authenticated;
grant execute on function public.save_asset_maintenance(jsonb) to authenticated;
grant execute on function public.close_asset_maintenance(jsonb) to authenticated;
grant execute on function public.asset_holders() to authenticated;
grant execute on function public.asset_stats(int) to authenticated;
