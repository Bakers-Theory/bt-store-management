-- ============================================================================
-- BT Store Management — buying stock and assets moves money
--
-- This migration deliberately REVERSES one earlier decision. 0062 note 4 and
-- 0061 note 6 kept the stock ledger and the asset register away from money, on
-- the grounds that the spend belongs on an expense or a purchase invoice. That
-- was true, and it left the operator to remember to file it twice. So:
--
--   1. THE SPEND IS STILL AN EXPENSE — IT IS JUST NOT TYPED IN TWICE. Nothing
--      here posts to cash_entry. A consumable purchase, an asset purchase and a
--      repair bill each create an `expense` row, which reaches the cash book
--      through pay_expense (0052/0059) like every other expense. One posting
--      path, one register, GST, reversal-on-cancel and the approval workflow all
--      come for free.
--   2. THE CASH BOOK ENTRY IS OPTIONAL, BECAUSE RECEIVING STOCK IS NOT. A stock
--      clerk who holds consumables.issue but not expense.create must still be
--      able to record what arrived. So a caller passes an `expense` block to ask
--      for the spend, and omits it to record the stock alone. Omitting it is the
--      pre-0066 behaviour, unchanged.
--   3. ONLY MONEY-MOVING EVENTS. A purchase, an asset, a repair or service cost.
--      Issue, wastage, expiry and damage are NOT here: the money left when the
--      stock was bought, and posting a write-off as well would count the same
--      spend twice. What those movements cost is a stock-value question, which
--      consumable_v.stock_value and the consumption report already answer.
--   4. ONE LINKED EXPENSE PER RECORD, ENFORCED BY AN INDEX. A movement, an
--      asset's purchase and a workshop job get at most one live expense each, so
--      a retried save cannot double-post. A repair expense carries `asset_id`
--      too, so the asset detail page can total everything that machine has cost.
--   5. A SINGLE PAYMENT MODE, NOT Mixed. pay_expense supports a split, but a
--      purchase form is not the place to describe one. Someone who genuinely
--      paid half in cash records it in the Expenses register and leaves the
--      purchase's cash book block off.
--   6. A LINKED EXPENSE'S AMOUNT IS NOT EDITABLE. It mirrors a cost recorded
--      elsewhere; letting the two drift would make the register lie about what
--      the asset or the stock cost. A trigger enforces it, so every path is
--      covered rather than each RPC remembering.
--   7. PAYING CAN FAIL, AND THE WHOLE SAVE FAILS WITH IT. pay_expense checks
--      funds (0059) and the closed-day rule (0049). If the drawer is short, the
--      asset is not registered either — one transaction, so the register and the
--      ledger cannot disagree. The operator's fix is to record it unpaid, or to
--      pay it from the bank.
--
-- Applies on top of 0063 (consumables) and 0061 (assets).
-- ============================================================================

-- ─── The link columns (note 4) ──────────────────────────────────────────────
alter table public.expense
  add column if not exists stock_movement_id uuid references public.stock_movement(id),
  add column if not exists asset_id uuid references public.asset(id),
  add column if not exists asset_maintenance_id uuid
    references public.asset_maintenance(id);

-- A row comes from the stock ledger or from the asset register, never both.
alter table public.expense drop constraint if exists expense_one_origin;
alter table public.expense add constraint expense_one_origin
  check (stock_movement_id is null
         or (asset_id is null and asset_maintenance_id is null));
-- A repair expense names its asset as well as its job (note 4).
alter table public.expense drop constraint if exists expense_job_has_asset;
alter table public.expense add constraint expense_job_has_asset
  check (asset_maintenance_id is null or asset_id is not null);

-- Note 4: live rows only, so a removed pending record does not block a retry.
create unique index if not exists expense_stock_movement_uniq
  on public.expense (stock_movement_id)
  where stock_movement_id is not null and deleted_at is null;
-- The PURCHASE expense is the one with no job attached; repairs are keyed by job.
create unique index if not exists expense_asset_purchase_uniq
  on public.expense (asset_id)
  where asset_id is not null and asset_maintenance_id is null and deleted_at is null;
create unique index if not exists expense_asset_maintenance_uniq
  on public.expense (asset_maintenance_id)
  where asset_maintenance_id is not null and deleted_at is null;

-- ─── Note 6: the amount and the link are both frozen ────────────────────────
create or replace function public.expense_link_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.stock_movement_id is distinct from old.stock_movement_id
     or new.asset_id is distinct from old.asset_id
     or new.asset_maintenance_id is distinct from old.asset_maintenance_id then
    raise exception 'the record this expense came from cannot be changed';
  end if;

  if old.amount <> new.amount
     and (old.stock_movement_id is not null or old.asset_id is not null) then
    raise exception
      'this expense mirrors what was recorded on the % — change it there, or cancel this expense and record a new one',
      case when old.stock_movement_id is not null then 'stock movement'
           when old.asset_maintenance_id is not null then 'repair job'
           else 'asset' end;
  end if;

  return new;
end $$;

drop trigger if exists expense_link_frozen on public.expense;
create trigger expense_link_frozen before update on public.expense
  for each row execute function public.expense_link_guard();

-- ─── record_linked_expense: the one writer for an automatic spend ───────────
-- Internal. Every caller is a definer function in this schema that has already
-- checked its own module permission; this checks the expense ones.
--
-- Returns the expense id, or NULL when the caller passed no block at all (note
-- 2). It never posts to cash itself — `pay` hands that to pay_expense.
create or replace function public.record_linked_expense(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cat public.cash_category;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_on date := nullif(p->>'incurredOn','')::date;
  v_paid_on date;
  v_mode text := coalesce(p->>'paymentMode','');
  v_gst_inc boolean := coalesce((p->>'gstIncluded')::boolean, false);
  v_gst numeric := round(coalesce((p->>'gstAmount')::numeric, 0), 2);
  v_supplier uuid := nullif(p->>'vendorSupplierId','')::uuid;
  v_pay boolean := coalesce((p->>'pay')::boolean, false);
  v_sm uuid := nullif(p->>'stockMovementId','')::uuid;
  v_asset uuid := nullif(p->>'assetId','')::uuid;
  v_job uuid := nullif(p->>'assetMaintenanceId','')::uuid;
  v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;

  -- Note 2: the module permission bought the stock; spending is a second key.
  if not public.has_perm('expense.create') then
    raise exception
      'you cannot record spending — save this without the cash book entry, or ask someone who can';
  end if;

  if v_amount <= 0 then
    raise exception 'a cash book entry needs a cost of more than zero';
  end if;
  if v_on is null then raise exception 'a cash book entry needs a date'; end if;
  if v_on > public.store_today() then
    raise exception 'a cash book date cannot be in the future';
  end if;
  v_paid_on := coalesce(nullif(p->>'paidOn','')::date, v_on);

  -- Note 5: one mode. `Mixed` is the Expenses register's job.
  if v_mode not in ('Cash','UPI','Bank Transfer') then
    raise exception 'choose how this was paid — cash, UPI or a bank transfer';
  end if;

  if v_gst_inc and (v_gst < 0 or v_gst >= v_amount) then
    raise exception 'the GST has to be less than the total, since it is included in it';
  end if;
  if not v_gst_inc then v_gst := 0; end if;

  -- The same four category rules save_expense applies (0052), for the same
  -- reason: post_cash files against a money-out leaf and nothing else.
  select * into v_cat from public.cash_category
   where id = nullif(p->>'categoryId','')::uuid and archived_at is null;
  if not found then raise exception 'choose a cash book category for this spend'; end if;
  if v_cat.is_system then
    raise exception '"%" is filled in automatically and cannot be chosen', v_cat.name;
  end if;
  if v_cat.direction = 'in' then
    raise exception '"%" is a money-in category', v_cat.name;
  end if;
  if not public.is_leaf_category(v_cat.id) then
    raise exception '"%" is a category group — choose one of the categories inside it',
      v_cat.name;
  end if;

  if v_supplier is not null
     and not exists (select 1 from public.suppliers where id = v_supplier) then
    raise exception 'that vendor no longer exists';
  end if;

  insert into public.expense (
    expense_date, category_id, vendor_name, vendor_supplier_id,
    amount, gst_included, gst_amount, payment_mode,
    invoice_no, description, paid_by, status,
    stock_movement_id, asset_id, asset_maintenance_id,
    created_by, updated_by)
  values (
    v_on, v_cat.id, btrim(coalesce(p->>'vendorName','')), v_supplier,
    v_amount, v_gst_inc, v_gst, v_mode,
    btrim(coalesce(p->>'invoiceNo','')), btrim(coalesce(p->>'description','')),
    auth.uid(), 'pending',
    v_sm, v_asset, v_job,
    auth.uid(), auth.uid())
  returning id into v_id;

  perform public.log_expense_event(v_id, 'created',
    jsonb_build_object(
      'amount', v_amount, 'category', v_cat.name,
      'linkedTo', case when v_sm is not null then 'consumable'
                       when v_job is not null then 'asset_maintenance'
                       when v_asset is not null then 'asset' end));

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('expense', auth.uid(), v_cat.name, v_amount,
            'Recorded expense of ' || v_amount::text || ' — ' || v_cat.name);

  -- Note 7: this is where funds and the closed-day rule are checked, and where
  -- the cash book row appears.
  if v_pay then
    if not public.has_perm('expense.pay') then
      raise exception
        'you can record this spend but not pay it — leave it for approval instead';
    end if;
    perform public.pay_expense(v_id, v_paid_on, v_mode, 0, 0, '');
  end if;

  return v_id;
end $$;

revoke execute on function public.record_linked_expense(jsonb) from public;

-- ─── record_stock_movement: a purchase may now carry its spend ──────────────
-- Restated in full (plpgsql has no way to patch a body); unchanged from 0063
-- apart from the `expense` block at the end and `expenseId` in the result.
create or replace function public.record_stock_movement(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.consumable;
  v_item uuid := nullif(p->>'consumableId','')::uuid;
  v_type text := coalesce(p->>'movementType','');
  v_qty numeric := round(coalesce((p->>'qty')::numeric, 0), 3);
  v_on date := coalesce(nullif(p->>'onDate','')::date, public.store_today());
  v_cost numeric := round(nullif(p->>'unitCost','')::numeric, 2);
  v_vendor uuid := nullif(p->>'vendorId','')::uuid;
  v_to uuid := nullif(p->>'issuedTo','')::uuid;
  v_reason text := btrim(coalesce(p->>'reason',''));
  v_signed numeric;
  v_before numeric;
  v_id uuid;
  v_link jsonb := case when jsonb_typeof(p->'expense') = 'object'
                       then p->'expense' end;
  v_expense uuid;
begin
  if v_type not in ('purchase','issue','return',
                    'adjustment','wastage','expired','damaged') then
    raise exception 'unknown movement type "%"', v_type;
  end if;

  -- Note 3 of 0063: which key applies is a property of the movement type.
  if v_type in ('purchase','issue','return') then
    if not public.has_perm('consumables.issue') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('consumables.adjust') then raise exception 'forbidden'; end if;
  end if;

  select * into c from public.consumable where id = v_item for update;
  if not found or c.deleted_at is not null then raise exception 'item not found'; end if;

  if v_type = 'adjustment' then
    if v_qty = 0 then raise exception 'an adjustment of zero changes nothing'; end if;
  elsif v_qty <= 0 then
    raise exception 'a quantity has to be more than zero';
  end if;

  if v_on > public.store_today() then
    raise exception 'a stock movement cannot be dated in the future';
  end if;
  -- Backdating is deliberately allowed: the first thing an operator does with a
  -- new item is enter the stock that was already on the shelf.

  -- §3.3: these four write off value, so they have to say why.
  if v_type in ('adjustment','wastage','expired','damaged') and v_reason = '' then
    raise exception 'say why this stock is being written off';
  end if;

  if v_cost is not null and v_type <> 'purchase' then
    raise exception 'a unit cost belongs on a purchase';
  end if;
  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;
  if v_to is not null
     and not exists (select 1 from public.profiles where id = v_to) then
    raise exception 'that employee no longer exists';
  end if;

  -- Note 3 of 0066: only a purchase spends money.
  if v_link is not null then
    if v_type <> 'purchase' then
      raise exception
        'only a purchase is money out — issuing or writing off stock does not move cash';
    end if;
    if v_cost is null then
      raise exception 'enter the cost per % so the spend can be recorded', c.unit;
    end if;
  end if;

  -- Mirrors the generated column in 0062 — direction comes from the type.
  v_signed := case v_type
                when 'purchase'   then abs(v_qty)
                when 'return'     then abs(v_qty)
                when 'adjustment' then v_qty
                else -abs(v_qty)
              end;

  -- Note 2 of 0063: computed under the row lock taken above, so the check holds
  -- under concurrency.
  select coalesce(sum(qty_signed), 0) into v_before
    from public.stock_movement where consumable_id = v_item;

  if v_before + v_signed < 0 then
    raise exception 'there is only % % on hand, so % cannot go out',
      trim(to_char(v_before, 'FM9999990.999')), c.unit,
      trim(to_char(abs(v_signed), 'FM9999990.999'));
  end if;

  insert into public.stock_movement (
    consumable_id, movement_type, qty, on_date, unit_cost,
    vendor_id, issued_to, reason, remarks, created_by)
  values (
    v_item, v_type, v_qty, v_on, v_cost,
    coalesce(v_vendor, case when v_type = 'purchase' then c.vendor_id end),
    v_to, v_reason, btrim(coalesce(p->>'remarks','')), auth.uid())
  returning id into v_id;

  insert into public.activity_log (type, actor, item_name, qty, reason, notes, total)
    values ('consumable', auth.uid(), c.name, v_qty,
            nullif(v_reason, ''),
            initcap(v_type) || ' of ' || trim(to_char(abs(v_qty), 'FM9999990.999'))
              || ' ' || c.unit || ' — ' || c.code,
            case when v_cost is not null then round(v_cost * abs(v_qty), 2) end);

  -- The spend. The amount is the ledger's own arithmetic, never a second figure
  -- typed into the form — that is what stops the two from disagreeing.
  if v_link is not null then
    v_expense := public.record_linked_expense(
      v_link || jsonb_build_object(
        'amount', round(v_cost * abs(v_qty), 2),
        'incurredOn', v_on,
        'stockMovementId', v_id,
        'vendorSupplierId', coalesce(nullif(v_link->>'vendorSupplierId',''),
                                     coalesce(v_vendor, c.vendor_id)::text, ''),
        'description', coalesce(nullif(btrim(v_link->>'description'), ''),
          trim(to_char(abs(v_qty), 'FM9999990.999')) || ' ' || c.unit
            || ' of ' || c.name || ' (' || c.code || ')')));
  end if;

  return jsonb_build_object(
    'movementId', v_id,
    'currentStock', v_before + v_signed,
    'expenseId', v_expense);
end $$;

-- ─── save_asset: registering an asset may record what it cost ───────────────
-- Restated in full; unchanged from 0061 apart from the `expense` block on the
-- create path. An EDIT never touches the expense (note 6): a price corrected
-- after the fact is a cancel-and-re-record in the Expenses register, because the
-- original may already have moved cash.
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
  v_link jsonb := case when jsonb_typeof(p->'expense') = 'object'
                       then p->'expense' end;
  v_code text;
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
    if v_link is not null then
      raise exception
        'the purchase was recorded when this asset was added — record any further spend as a repair or an expense';
    end if;

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
  returning id, code into v_id, v_code;

  perform public.log_asset_event(v_id, 'created',
    jsonb_build_object('name', v_name, 'category', v_cat, 'price', v_price));

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('asset', auth.uid(), v_name, v_price,
            'Added asset ' || v_code || ' (' || v_cat || ')');

  -- The purchase, as an expense. `purchase_date` is when the cost was incurred;
  -- the cash book uses the payment date pay_expense is given.
  if v_link is not null then
    if v_price <= 0 then
      raise exception 'enter what this asset cost so the spend can be recorded';
    end if;
    perform public.record_linked_expense(
      v_link || jsonb_build_object(
        'amount', v_price,
        'incurredOn', v_purchased,
        'assetId', v_id,
        'vendorSupplierId', coalesce(nullif(v_link->>'vendorSupplierId',''),
                                     v_vendor::text, ''),
        'description', coalesce(nullif(btrim(v_link->>'description'), ''),
          'Purchase of ' || v_name || ' (' || v_code || ')')));
  end if;

  return v_id;
end $$;

-- ─── Two helpers the three asset-maintenance paths share ────────────────────
create or replace function public.assert_job_unbilled(p_job uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_no bigint;
begin
  select expense_no into v_no from public.expense
   where asset_maintenance_id = p_job and deleted_at is null;
  if v_no is not null then
    raise exception 'this job''s cost is already recorded as expense #%', v_no;
  end if;
end $$;

create or replace function public.record_job_expense(
  p_link jsonb, p_job uuid, p_asset uuid, p_cost numeric, p_on date
)
returns void language plpgsql security definer set search_path = public as $$
declare m public.asset_maintenance; a public.asset;
begin
  select * into m from public.asset_maintenance where id = p_job;
  select * into a from public.asset where id = p_asset;

  perform public.record_linked_expense(
    p_link || jsonb_build_object(
      'amount', round(p_cost, 2),
      'incurredOn', p_on,
      'assetId', p_asset,
      'assetMaintenanceId', p_job,
      'vendorSupplierId', coalesce(nullif(p_link->>'vendorSupplierId',''),
                                   m.vendor_id::text, ''),
      'description', coalesce(nullif(btrim(p_link->>'description'), ''),
        initcap(m.kind) || ' on ' || a.name || ' (' || a.code || ')')));
end $$;

revoke execute on function public.assert_job_unbilled(uuid) from public;
revoke execute on function public.record_job_expense(jsonb, uuid, uuid, numeric, date)
  from public;

-- ─── save_asset_maintenance: opening a job may record its bill ──────────────
-- Restated in full; unchanged from 0061 apart from the `expense` block. Either
-- this or close_asset_maintenance may carry it — an AMC is paid up front and
-- never "completes", a repair is usually paid when the machine comes back — but
-- only one of them can, because a job has one cost (note 4).
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
  v_link jsonb := case when jsonb_typeof(p->'expense') = 'object'
                       then p->'expense' end;
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
  if v_link is not null and v_cost <= 0 then
    raise exception 'enter the cost so the spend can be recorded';
  end if;

  -- ── Edit an existing job ─────────────────────────────────────────────────
  if v_id is not null then
    select * into v_old from public.asset_maintenance where id = v_id for update;
    if not found then raise exception 'maintenance record not found'; end if;
    if v_old.status = 'closed' then
      raise exception 'this job is closed — its history cannot be rewritten';
    end if;

    -- Note 4: one cost, one expense. Said in words rather than by index.
    if v_link is not null then
      perform public.assert_job_unbilled(v_id);
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

    -- Note 4 of 0061: a schedule can exist before any job is finished.
    if v_next is not null then
      update public.asset set next_service_date = v_next, updated_by = auth.uid()
       where id = v_old.asset_id;
    end if;

    perform public.log_asset_event(v_old.asset_id, 'maintenance_opened',
      jsonb_build_object('maintenanceId', v_id, 'kind', v_kind, 'edited', true));

    if v_link is not null then
      perform public.record_job_expense(v_link, v_id, v_old.asset_id, v_cost, v_started);
    end if;

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

  -- Note 5 of 0061: the status change is part of opening the job, and it closes
  -- any open custody row on the way (move_asset_status → close_open_custody).
  if v_out then
    perform public.move_asset_status(v_asset,
      case when v_kind = 'repair' then 'under_repair' else 'maintenance' end,
      v_started, 'Sent for ' || v_kind);
  end if;

  if v_link is not null then
    perform public.record_job_expense(v_link, v_id, v_asset, v_cost, v_started);
  end if;

  return v_id;
end $$;

-- ─── close_asset_maintenance: the closing bill ──────────────────────────────
-- Restated in full; unchanged from 0061 apart from the `expense` block. The cost
-- is only final here for a repair, which is why this is the usual place to
-- record it.
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
  v_link jsonb := case when jsonb_typeof(p->'expense') = 'object'
                       then p->'expense' end;
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
  -- Note 3 of 0061: retiring stays an Admin act even on this path.
  if v_to = 'retired' and not public.has_perm('assets.delete') then
    raise exception 'forbidden';
  end if;
  if v_next is not null and v_next < v_completed then
    raise exception 'the next service cannot be due before this one finished';
  end if;
  if v_link is not null then
    if v_cost <= 0 then
      raise exception 'enter the cost so the spend can be recorded';
    end if;
    perform public.assert_job_unbilled(v_id);
  end if;

  update public.asset_maintenance
     set status = 'closed', completed_on = v_completed,
         cost = v_cost,
         next_service_on = coalesce(v_next, next_service_on),
         notes = case when btrim(coalesce(p->>'notes','')) <> ''
                      then btrim(p->>'notes') else notes end,
         updated_by = auth.uid()
   where id = v_id;

  -- Note 4 of 0061: the single writer of last_service_date.
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

  if v_link is not null then
    perform public.record_job_expense(v_link, v_id, m.asset_id, v_cost, v_completed);
  end if;
end $$;

-- ─── Read surface: where an expense came from ───────────────────────────────
create or replace view public.expense_v as
select
  e.id, e.expense_no, e.expense_date, e.paid_on,
  e.category_id,
  c.name as category_name,
  coalesce(pc.name, '') as category_group,
  case when pc.name is null then c.name else pc.name || ' › ' || c.name end
    as category_path,
  e.vendor_name, e.vendor_supplier_id,
  -- A linked supplier's name wins, so the vendor-wise report gets one identity.
  coalesce(nullif(s.name, ''), e.vendor_name) as vendor_display,
  e.amount, e.gst_included, e.gst_amount,
  e.payment_mode, e.split_cash, e.split_bank, e.split_bank_mode,
  e.invoice_no, e.description,
  e.paid_by,
  coalesce(pb.name, '') as paid_by_name,
  coalesce(ab.name, '') as approved_by_name,
  e.status, e.reject_reason, e.cancel_reason,
  e.created_by,
  coalesce(cb.name, '') as created_by_name,
  e.created_at,
  coalesce(ub.name, '') as updated_by_name,
  e.updated_at,

  -- 0066: the record this expense mirrors, so the register can say "this came
  -- from receiving stock" rather than looking like a hand-typed entry.
  e.stock_movement_id, e.asset_id, e.asset_maintenance_id,
  case
    when e.stock_movement_id is not null    then 'consumable'
    when e.asset_maintenance_id is not null then 'asset_maintenance'
    when e.asset_id is not null             then 'asset'
    else ''
  end as origin_type,
  coalesce(
    case
      when e.stock_movement_id is not null then co.code || ' — ' || co.name
      when e.asset_id is not null then ast.code || ' — ' || ast.name
    end, '') as origin_ref
from public.expense e
join public.cash_category c on c.id = e.category_id
left join public.cash_category pc on pc.id = c.parent_id
left join public.suppliers s on s.id = e.vendor_supplier_id
left join public.profiles pb on pb.id = e.paid_by
left join public.profiles ab on ab.id = e.approved_by
left join public.profiles cb on cb.id = e.created_by
left join public.profiles ub on ub.id = e.updated_by
left join public.stock_movement sm on sm.id = e.stock_movement_id
left join public.consumable co on co.id = sm.consumable_id
left join public.asset ast on ast.id = e.asset_id
where e.deleted_at is null
  and public.has_perm('expense.view');

grant select on public.expense_v to authenticated;

-- The cash book's own handle for an expense row. Until now `source_ref` was
-- blank for every expense, which made an auto-posted purchase unreadable in the
-- ledger — the whole point of posting it there.
create or replace view public.cash_entry_v as
select
  e.id, e.on_date, e.created_at, e.account, e.direction, e.amount,
  e.payment_mode, e.category_id,
  c.name as category_name,
  coalesce(pc.name, '') as category_group,
  case when pc.name is null then c.name else pc.name || ' › ' || c.name end
    as category_path,
  e.source_type, e.source_id, e.reverses_id, e.transfer_id,
  e.reference_no, e.note,
  e.created_by,
  coalesce(p.name, '') as created_by_name,
  case
    when e.reverses_id is not null then 'reversal'
    when exists (select 1 from public.cash_entry r
                  where r.reverses_id = e.id and r.deleted_at is null) then 'reversed'
    else 'posted'
  end as status,
  coalesce(case e.source_type
    when 'bill' then
      (select '#' || b.bill_no::text from public.bills b where b.id = e.source_id)
    when 'salary' then
      (select pr.name from public.salary_payment sp
        join public.profiles pr on pr.id = sp.profile_id where sp.id = e.source_id)
    when 'advance' then
      (select pr.name from public.staff_advance a
        join public.profiles pr on pr.id = a.profile_id where a.id = e.source_id)
    when 'supplier_payment' then
      (select s.name from public.supplier_payment sp
        join public.suppliers s on s.id = sp.supplier_id where sp.id = e.source_id)
    when 'expense' then
      (select '#' || x.expense_no::text
                || coalesce(' · ' || nullif(
                     coalesce(xc.code, xa.code), ''), '')
         from public.expense x
         left join public.stock_movement xsm on xsm.id = x.stock_movement_id
         left join public.consumable xc on xc.id = xsm.consumable_id
         left join public.asset xa on xa.id = x.asset_id
        where x.id = e.source_id)
  end, '') as source_ref,
  -- 0057's tiebreaker, and its trailing `seq` column: a replaced view may gain
  -- columns but never lose one.
  sum(case when e.direction = 'in' then e.amount else -e.amount end)
    over (partition by e.account order by e.on_date, e.created_at, e.seq)
    as running_balance,
  e.seq
from public.cash_entry e
join public.cash_category c on c.id = e.category_id
left join public.cash_category pc on pc.id = c.parent_id
left join public.profiles p on p.id = e.created_by
where e.deleted_at is null
  and public.has_perm('cashbook.view');

grant select on public.cash_entry_v to authenticated;
