-- ============================================================================
-- BT Store Management — granular RBAC
--
-- Replaces the three coarse permission booleans (perm_sales / perm_inventory /
-- perm_analytics) with `profiles.perms text[]`, holding keys from a 25-entry
-- catalogue mirrored in src/lib/permissions.ts.
--
-- The stored `role` column is deliberately UNCHANGED ('Owner' | 'Staff'):
-- Admin / Manager / Cashier / Storekeeper are presets that stamp a permission
-- set in the UI, not stored roles. `perms` is the only thing enforced, and the
-- role badge the UI shows is derived from it — so a label can never disagree
-- with the actual grants.
--
-- has_perm() keeps answering the three legacy group keys (resolved as "holds any
-- permission in that group"), so read policies and any RPC not individually
-- rewritten below behave exactly as before.
--
-- Not grantable, Owner-only, and therefore absent from the catalogue:
-- clear_all_data() and activity_log_admin_v.
-- ============================================================================

-- ─── Schema: perms array, backfilled from the booleans ──────────────────────
alter table public.profiles
  add column if not exists perms text[] not null default '{}';

-- Faithful translation of each coarse flag. Deliberate asymmetry: 'analytics'
-- does NOT backfill reports.* because the Reports page was Owner-only in the
-- UI, so an analytics staff member could never open it — granting it here would
-- *widen* access rather than preserve it. Store admin keys go to nobody, for
-- the same reason.
-- Guarded so re-running this file after the columns are dropped is a no-op
-- rather than an error.
do $backfill$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'perm_sales'
  ) then
    update public.profiles set perms = (
      select coalesce(array_agg(distinct k), '{}')
      from (
        select unnest(case when perm_sales then array[
                 'bill.create','bill.discount','bill.print','bill.cancel',
                 'bill.delete','bill.history','customers.view','customers.edit',
                 'activity.view'
               ] else '{}'::text[] end) as k
        union all
        select unnest(case when perm_inventory then array[
                 'stock.view','stock.in','stock.out','stock.expiry',
                 'items.create','items.edit','items.delete','items.cost',
                 'activity.view'
               ] else '{}'::text[] end)
        union all
        select unnest(case when perm_analytics then array[
                 'dashboard.view','dashboard.profit','items.cost'
               ] else '{}'::text[] end)
      ) g
    )
    where role <> 'Owner' and perms = '{}';
  end if;
end $backfill$;

alter table public.profiles
  drop column if exists perm_sales,
  drop column if exists perm_inventory,
  drop column if exists perm_analytics;

-- ─── has_perm: granular, with legacy group keys still answered ──────────────
create or replace function public.has_perm(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'Owner'                       -- Owner implicitly holds everything
        or perm = any (p.perms)
        -- Legacy coarse groups: "holds any permission in this area".
        or (perm = 'sales' and p.perms && array[
              'bill.create','bill.discount','bill.print','bill.cancel',
              'bill.delete','bill.history','customers.view','customers.edit'])
        or (perm = 'inventory' and p.perms && array[
              'stock.view','stock.in','stock.out','stock.expiry',
              'items.create','items.edit','items.delete','items.cost'])
        or (perm = 'analytics' and p.perms && array[
              'dashboard.view','dashboard.profit','reports.view','reports.export'])
      )
  )
$$;

-- ─── New-user trigger: read `perms` (a JSON array) from user metadata ───────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, user_id, name, role, perms)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'user_id', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'name', 'Staff'),
    coalesce(new.raw_user_meta_data->>'role', 'Staff'),
    coalesce((
      select array_agg(k)
      from jsonb_array_elements_text(
        case when jsonb_typeof(new.raw_user_meta_data->'perms') = 'array'
             then new.raw_user_meta_data->'perms' else '[]'::jsonb end
      ) as t(k)
    ), '{}'::text[])
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ============================================================================
-- Read surface
-- ============================================================================

-- profiles: staff managers read and write the roster, never the Owner's row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.has_perm('staff.manage'));
drop policy if exists profiles_owner_write on public.profiles;
drop policy if exists profiles_staff_write on public.profiles;
create policy profiles_staff_write on public.profiles for all
  using (public.has_perm('staff.manage') and role <> 'Owner')
  with check (public.has_perm('staff.manage') and role <> 'Owner');

-- store_settings: writes need store.settings (was Owner-only).
drop policy if exists settings_write on public.store_settings;
create policy settings_write on public.store_settings for update
  using (public.has_perm('store.settings'))
  with check (public.has_perm('store.settings'));

-- items / stock_batches: a cashier has no stock.view but must still read the
-- catalogue to bill. cost_price stays revoked at the column level regardless,
-- so this widens nothing sensitive.
drop policy if exists items_read on public.items;
create policy items_read on public.items for select
  using (public.has_perm('stock.view') or public.has_perm('bill.create')
      or public.has_perm('dashboard.view') or public.has_perm('reports.view'));
drop policy if exists stock_batches_read on public.stock_batches;
create policy stock_batches_read on public.stock_batches for select
  using (public.has_perm('stock.view') or public.has_perm('bill.create')
      or public.has_perm('dashboard.view') or public.has_perm('reports.view'));

-- bills / bill_items: readable by bill readers and by whoever can ring one up.
drop policy if exists bills_read on public.bills;
create policy bills_read on public.bills for select
  using (public.has_perm('bill.history') or public.has_perm('bill.create')
      or public.has_perm('dashboard.view') or public.has_perm('reports.view'));
drop policy if exists bill_items_read on public.bill_items;
create policy bill_items_read on public.bill_items for select
  using (public.has_perm('bill.history') or public.has_perm('bill.create')
      or public.has_perm('dashboard.view') or public.has_perm('reports.view'));

-- activity_log: its own permission now, rather than riding on sales/inventory.
drop policy if exists log_read on public.activity_log;
create policy log_read on public.activity_log for select
  using (public.has_perm('activity.view'));

-- customers: view is its own key.
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select
  using (public.has_perm('customers.view') or public.has_perm('bill.create'));

-- ─── items_v: cost visibility splits from inventory access ──────────────────
-- Reproduced from 0022 with only the cost_price CASE re-keyed.
create or replace view public.items_v as
  select
    id, name, emoji, category, unit, price,
    case when public.has_perm('items.cost') or public.has_perm('dashboard.profit')
         then cost_price else null end as cost_price,
    qty, created_at, updated_at,
    tracks_expiry,
    (select min(sb.expiry_date) from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as earliest_expiry,
    (select coalesce(
              jsonb_agg(
                jsonb_build_object('qty', sb.qty, 'expiryDate', sb.expiry_date)
                order by sb.expiry_date asc nulls last, sb.created_at asc),
              '[]'::jsonb)
       from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as batches,
    image_url
  from public.items;
grant select on public.items_v to authenticated;

-- ─── bills_v / activity_log_v: re-keyed ─────────────────────────────────────
drop view if exists public.bills_v;
create view public.bills_v as
  select b.*, p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('bill.history') or public.has_perm('bill.create')
     or public.has_perm('dashboard.view') or public.has_perm('reports.view');
grant select on public.bills_v to authenticated;

create or replace view public.activity_log_v as
  select
    l.id, l.type, l.created_at,
    l.item_id, l.item_name, l.qty, l.supplier, l.reason, l.notes,
    l.bill_no, l.items, l.total,
    p.name as actor_name
  from public.activity_log l
  left join public.profiles p on p.id = l.actor
  where public.has_perm('activity.view');
grant select on public.activity_log_v to authenticated;

-- ============================================================================
-- Inventory RPCs — one key each
-- Bodies reproduced verbatim from their latest definitions; only the permission
-- check changes, except where noted.
-- ============================================================================

-- create_item → items.create
-- NOTE: 0022 reproduced this body from 0016 rather than 0019, silently dropping
-- the assert_store_open() guard 0019 had added. Restored here.
create or replace function public.create_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dup public.items; v_id uuid;
        v_qty numeric := coalesce((p->>'qty')::numeric, 0);
        v_tracks boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_expiry date := nullif(p->>'expiryDate','')::date;
        v_row public.items_v;
begin
  if not public.has_perm('items.create') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  select * into v_dup from public.items where name_key = lower(trim(p->>'name'));
  if found then
    if v_qty > 0 then
      perform public.add_batch(v_dup.id, v_qty, v_expiry);
      insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
        values ('in', auth.uid(), v_dup.id, v_dup.name, v_qty,
                'Added via New Item form (existing item)');
    end if;
    select * into v_row from public.items_v where id = v_dup.id;
    return jsonb_build_object('kind','merged','name',v_dup.name,'qty',v_qty,'unit',v_dup.unit,
                               'item',to_jsonb(v_row));
  end if;
  insert into public.items (name, emoji, category, unit, price, cost_price, qty, tracks_expiry, image_url)
    values (p->>'name', coalesce(p->>'emoji','📦'), p->>'category', p->>'unit',
            coalesce((p->>'price')::numeric,0), coalesce((p->>'costPrice')::numeric,0),
            0, v_tracks, nullif(p->>'imageUrl',''))
    returning id into v_id;
  if v_qty > 0 then
    perform public.add_batch(v_id, v_qty, v_expiry);
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values ('in', auth.uid(), v_id, p->>'name', v_qty, 'Initial stock');
  end if;
  select * into v_row from public.items_v where id = v_id;
  return jsonb_build_object('kind','added','id',v_id,'item',to_jsonb(v_row));
end $$;

-- update_item → items.edit (assert_store_open restored, same 0022 regression)
create or replace function public.update_item(p_id uuid, p jsonb)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_tracks_old boolean;
        v_tracks_new boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_sum numeric; v_row public.items_v;
begin
  if not public.has_perm('items.edit') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  select tracks_expiry into v_tracks_old from public.items where id = p_id;
  if not found then raise exception 'item not found'; end if;
  -- Cost is only writable by someone who can see it. Otherwise an editor
  -- without items.cost would silently zero the purchase price on every save,
  -- since the view hands them null for that column.
  update public.items set
    name = p->>'name', emoji = coalesce(p->>'emoji','📦'), category = p->>'category',
    unit = p->>'unit', price = coalesce((p->>'price')::numeric,0),
    cost_price = case when public.has_perm('items.cost')
                      then coalesce((p->>'costPrice')::numeric, 0)
                      else cost_price end,
    tracks_expiry = v_tracks_new,
    image_url = nullif(p->>'imageUrl','')
  where id = p_id;
  if v_tracks_old and not v_tracks_new then
    select coalesce(sum(qty),0) into v_sum from public.stock_batches where item_id = p_id;
    delete from public.stock_batches where item_id = p_id;
    if v_sum > 0 then
      insert into public.stock_batches (item_id, qty, expiry_date) values (p_id, v_sum, null);
    end if;
  end if;
  select * into v_row from public.items_v where id = p_id;
  return v_row;
end $$;

-- delete_item → items.delete
create or replace function public.delete_item(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('items.delete') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  delete from public.items where id = p_id;
end $$;

-- set_item_image → items.edit (no store-open guard: 0023 never had one, and
-- adding it here would be an unrelated behaviour change)
create or replace function public.set_item_image(p_id uuid, p_url text)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_row public.items_v;
begin
  if not public.has_perm('items.edit') then raise exception 'forbidden'; end if;
  update public.items set image_url = nullif(p_url, '') where id = p_id;
  if not found then raise exception 'item not found'; end if;
  select * into v_row from public.items_v where id = p_id;
  return v_row;
end $$;

-- stock_in → stock.in
create or replace function public.stock_in(p_item uuid, p_qty numeric, p_supplier text, p_notes text, p_expiry date)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v public.items; v_row public.items_v;
begin
  if not public.has_perm('stock.in') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item;
  if not found then raise exception 'item not found'; end if;
  perform public.add_batch(p_item, p_qty, p_expiry);
  insert into public.activity_log (type, actor, item_id, item_name, qty, supplier, notes)
    values ('in', auth.uid(), p_item, v.name, p_qty, p_supplier, p_notes);
  select * into v_row from public.items_v where id = p_item;
  return v_row;
end $$;

-- stock_out → stock.out
create or replace function public.stock_out(p_item uuid, p_qty numeric, p_reason text, p_notes text)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v public.items; v_row public.items_v;
begin
  if not public.has_perm('stock.out') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if p_qty > v.qty then raise exception 'only % available', v.qty; end if;
  perform public.consume_fifo(p_item, p_qty);
  insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
    values ('out', auth.uid(), p_item, v.name, p_qty, p_reason, p_notes);
  select * into v_row from public.items_v where id = p_item;
  return v_row;
end $$;

-- write_off_batch → stock.expiry
create or replace function public.write_off_batch(p_batch_id uuid)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare b public.stock_batches; v_name text; v_row public.items_v;
begin
  if not public.has_perm('stock.expiry') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  select * into b from public.stock_batches where id = p_batch_id for update;
  if not found then raise exception 'batch not found'; end if;
  select name into v_name from public.items where id = b.item_id;
  delete from public.stock_batches where id = p_batch_id;
  update public.items set qty =
    coalesce((select sum(qty) from public.stock_batches where item_id = b.item_id), 0)
    where id = b.item_id;
  insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
    values ('out', auth.uid(), b.item_id, v_name, b.qty, 'Write-off',
            case when b.expiry_date is null then 'Batch write-off'
                 else 'Batch expiring ' || b.expiry_date::text end);
  select * into v_row from public.items_v where id = b.item_id;
  return v_row;
end $$;

-- update_batch_expiry → stock.expiry
create or replace function public.update_batch_expiry(p_batch_id uuid, p_expiry date)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_item_id uuid; v_row public.items_v;
begin
  if not public.has_perm('stock.expiry') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  if p_expiry is null then raise exception 'expiry date required'; end if;
  update public.stock_batches set expiry_date = p_expiry where id = p_batch_id
    returning item_id into v_item_id;
  if not found then raise exception 'batch not found'; end if;
  select * into v_row from public.items_v where id = v_item_id;
  return v_row;
end $$;

-- ============================================================================
-- Billing RPCs
-- ============================================================================

-- generate_bill → bill.create, plus bill.discount when a discount is applied.
-- Reproduced from 0026; only the two permission checks are new.
create or replace function public.generate_bill(customer jsonb, lines jsonb, p_tz text default 'UTC')
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_type text; v_disc numeric := 0; v_amt numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
begin
  if not public.has_perm('bill.create') then raise exception 'forbidden'; end if;
  -- A biller without bill.discount cannot smuggle one in through the payload.
  if coalesce((customer->>'discount')::numeric, 0) > 0
     and not public.has_perm('bill.discount') then
    raise exception 'not allowed to apply a discount';
  end if;
  if not (select is_open from public.store_settings where id = 1) then
    raise exception 'Store is closed — new bills cannot be created';
  end if;

  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;
  v_sub := round(v_sub, 2);

  if v_phone <> '' then
    insert into public.customers (phone, name)
      values (v_phone, coalesce(customer->>'name',''))
      on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name
                        else public.customers.name end,
            last_seen = now()
      returning id into v_customer;
  end if;

  -- Flat clamps the ₹-off to the subtotal; percent clamps the rate to 0–100.
  v_type := case when customer->>'discountType' = 'flat' then 'flat' else 'percent' end;
  if v_type = 'flat' then
    v_amt := least(v_sub, greatest(0, round(coalesce((customer->>'discount')::numeric, 0), 2)));
  else
    v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
    v_amt := round(v_sub * v_disc / 100, 2);
  end if;
  v_taxable := round(v_sub - v_amt, 2);
  v_tax := round(v_taxable * v_rate / 100, 2);
  insert into public.bills (customer_name, customer_phone, customer_id,
                            subtotal, tax, total, tax_rate, payment_method,
                            discount_percent, discount_type, discount_amount, created_by)
    values (coalesce(customer->>'name',''), v_phone, v_customer,
            v_sub, v_tax, round(v_taxable + v_tax, 2), v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            v_disc, v_type, v_amt, auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price, image_url)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price, it.image_url);
    perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;
grant execute on function public.generate_bill(jsonb, jsonb, text) to authenticated;

-- cancel_bill → bill.cancel
create or replace function public.cancel_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('bill.cancel') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status = 'cancelled' then raise exception 'already cancelled'; end if;
  for li in select * from public.bill_items where bill_id = p_id loop
    if li.item_id is not null then
      perform public.add_batch(li.item_id, li.qty, null);
    end if;
  end loop;
  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id;
  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('cancel', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Cancelled by ' || p_by);
end $$;

-- delete_bill → bill.delete
create or replace function public.delete_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('bill.delete') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status <> 'cancelled' then
    for li in select * from public.bill_items where bill_id = p_id loop
      if li.item_id is not null then
        perform public.add_batch(li.item_id, li.qty, null);
      end if;
    end loop;
  end if;
  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('delete', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Deleted by ' || p_by);
  delete from public.bills where id = p_id;   -- cascades bill_items
end $$;

-- ============================================================================
-- Customer RPCs
-- ============================================================================

-- update_customer → customers.edit
create or replace function public.update_customer(p_id uuid, p_name text, p_phone text)
returns public.customers language plpgsql security definer set search_path = public as $$
declare v_row public.customers;
        v_phone text := nullif(btrim(p_phone), '');
begin
  if not public.has_perm('customers.edit') then raise exception 'forbidden'; end if;
  if v_phone is null then raise exception 'Phone number is required'; end if;

  update public.customers
    set name = coalesce(p_name, ''), phone = v_phone
    where id = p_id
    returning * into v_row;
  if not found then raise exception 'Customer not found'; end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'Another customer already uses that phone number';
end $$;

-- customers_with_stats → customers.view
create or replace function public.customers_with_stats()
returns table (
  id            uuid,
  phone         text,
  name          text,
  first_seen    timestamptz,
  visit_count   bigint,
  total_spend   numeric,
  last_purchase timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.phone, c.name, c.first_seen,
         count(b.id) filter (where b.status = 'active')            as visit_count,
         coalesce(sum(b.total) filter (where b.status = 'active'), 0) as total_spend,
         max(b.created_at) filter (where b.status = 'active')      as last_purchase
  from public.customers c
  left join public.bills b on b.customer_id = c.id
  where public.has_perm('customers.view')
  group by c.id
$$;

-- customer_by_phone → customers.view or bill.create (checkout autofill needs it
-- even for a cashier who cannot open the directory).
create or replace function public.customer_by_phone(p_phone text)
returns table (
  id            uuid,
  phone         text,
  name          text,
  first_seen    timestamptz,
  visit_count   bigint,
  total_spend   numeric,
  last_purchase timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.phone, c.name, c.first_seen,
         count(b.id) filter (where b.status = 'active')            as visit_count,
         coalesce(sum(b.total) filter (where b.status = 'active'), 0) as total_spend,
         max(b.created_at) filter (where b.status = 'active')      as last_purchase
  from public.customers c
  left join public.bills b on b.customer_id = c.id
  where c.phone = p_phone
    and (public.has_perm('customers.view') or public.has_perm('bill.create'))
  group by c.id
$$;

-- ============================================================================
-- Store admin RPCs — were Owner-only, now individually grantable
-- ============================================================================

-- save_settings → store.settings (reproduced from 0018, audit insert kept)
create or replace function public.save_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('store.settings') then raise exception 'forbidden'; end if;
  update public.store_settings set
    name = coalesce(nullif(p->>'name',''), 'My Bakery'),
    tagline = coalesce(p->>'tagline',''),
    address = coalesce(p->>'address',''),
    phone = coalesce(p->>'phone',''),
    gst = coalesce(p->>'gst',''),
    currency = coalesce(nullif(p->>'currency',''),'₹'),
    tax_rate = coalesce((p->>'taxRate')::numeric,0),
    low_stock_alert = coalesce((p->>'lowStockAlert')::numeric,5),
    expiring_soon_days = coalesce((p->>'expiringSoonDays')::integer,3)
  where id = 1;
  insert into public.activity_log (type, actor, notes)
    values ('settings', auth.uid(), 'Updated store settings');
end $$;

-- update_logo → store.settings
create or replace function public.update_logo(p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('store.settings') then raise exception 'forbidden'; end if;
  update public.store_settings set logo_url = p_url where id = 1;
end $$;

-- set_store_status → store.status
create or replace function public.set_store_status(p_open boolean, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('store.status') then raise exception 'forbidden'; end if;
  update public.store_settings
    set is_open = p_open, status_changed_at = now(), status_changed_by = p_by
    where id = 1;
  insert into public.activity_log (type, actor)
    values (case when p_open then 'open' else 'close' end, auth.uid());
end $$;

-- add_list_value / delete_list_value → store.lists
create or replace function public.add_list_value(p_kind text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := trim(p_value); v_next int;
begin
  if not public.has_perm('store.lists') then raise exception 'forbidden'; end if;
  if p_kind not in ('category','emoji','unit','reason') then
    raise exception 'unknown list';
  end if;
  if v = '' then raise exception 'value is required'; end if;
  if exists (select 1 from public.store_lists where kind = p_kind and value = v) then
    raise exception '"%" already exists', v;
  end if;
  select coalesce(max(sort_order), -1) + 1 into v_next
    from public.store_lists where kind = p_kind;
  insert into public.store_lists (kind, value, sort_order) values (p_kind, v, v_next);
end $$;

create or replace function public.delete_list_value(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.store_lists; n int;
begin
  if not public.has_perm('store.lists') then raise exception 'forbidden'; end if;
  select * into r from public.store_lists where id = p_id;
  if not found then raise exception 'not found'; end if;
  if r.kind = 'category' then
    select count(*) into n from public.items where category = r.value;
    if n > 0 then raise exception 'in use by % item(s)', n; end if;
  elsif r.kind = 'unit' then
    select count(*) into n from public.items where unit = r.value;
    if n > 0 then raise exception 'in use by % item(s)', n; end if;
  end if;
  delete from public.store_lists where id = p_id;
end $$;

-- ============================================================================
-- Analytics — cost visibility splits from dashboard access
-- ============================================================================

-- bill_lines_with_cost → dashboard.profit (drives report COGS / profit / margin)
create or replace function public.bill_lines_with_cost()
returns table (id uuid, bill_id uuid, item_id uuid, category text, qty numeric,
               price numeric, cost_price numeric, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select bi.id, bi.bill_id, bi.item_id, i.category, bi.qty, bi.price, bi.cost_price,
         b.status, b.created_at
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  left join public.items i on i.id = bi.item_id
  where public.has_perm('dashboard.profit') or public.has_perm('reports.export')
$$;

-- dashboard_stats: gate on dashboard.view; COGS on dashboard.profit; the
-- recent-bills tile on bill.history. Reproduced from 0025 — only the three
-- permission expressions and the guard change.
create or replace function public.dashboard_stats(
  p_tz text default 'UTC',
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_can_bills boolean := public.has_perm('bill.history');
  v_can_cost  boolean := public.has_perm('dashboard.profit');
  v_today     date := (now() at time zone p_tz)::date;
  v_bounded   boolean := p_from is not null and p_to is not null;
  v_span      int  := case when v_bounded then greatest(1, (p_to - p_from) + 1) end;
  v_prev_from date := case when v_bounded then p_from - v_span end;
  v_prev_to   date := case when v_bounded then p_from - 1 end;
begin
  if not public.has_perm('dashboard.view') then
    raise exception 'forbidden';
  end if;

  return (
    with
    active as (
      select
        b.id, b.total, b.created_at,
        (b.created_at at time zone p_tz) as local_ts,
        (b.created_at at time zone p_tz)::date as local_date
      from public.bills b
      where b.status = 'active'
        and (p_from is null or (b.created_at at time zone p_tz)::date >= p_from)
        and (p_to   is null or (b.created_at at time zone p_tz)::date <= p_to)
    ),
    active_lines as (
      select
        bi.item_id, bi.name, bi.qty, bi.price, bi.cost_price,
        coalesce(i.category, 'General') as category,
        a.local_date
      from public.bill_items bi
      join active a on a.id = bi.bill_id
      left join public.items i on i.id = bi.item_id
    ),
    -- Preceding equal-length window (only meaningful when the range is bounded).
    prev as (
      select b.id, b.total
      from public.bills b
      where v_bounded
        and b.status = 'active'
        and (b.created_at at time zone p_tz)::date between v_prev_from and v_prev_to
    ),
    prev_lines as (
      select bi.qty
      from public.bill_items bi
      join prev p on p.id = bi.bill_id
    )
    select jsonb_build_object(

      'today', v_today::text,

      'kpis', jsonb_build_object(
        'rangeSales',    (select coalesce(sum(total), 0) from active),
        'prevSales',     case when not v_bounded then 0 else (select coalesce(sum(total), 0) from prev) end,
        'billsInRange',  (select count(*) from active),
        'prevBills',     case when not v_bounded then 0 else (select count(*) from prev) end,
        'itemsSold',     (select coalesce(sum(qty), 0) from active_lines),
        'prevItemsSold', case when not v_bounded then 0 else (select coalesce(sum(qty), 0) from prev_lines) end
      ),

      -- Per-day totals across the range (client fills empty buckets).
      'weekly', coalesce((
        select jsonb_agg(jsonb_build_object('date', d::text, 'total', t) order by d)
        from (select local_date as d, sum(total) as t from active group by local_date) w
      ), '[]'::jsonb),

      'topItems', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'qty', qty) order by qty desc)
        from (
          select name, sum(qty) as qty
          from active_lines group by name order by sum(qty) desc limit 5
        ) t
      ), '[]'::jsonb),

      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'category', category,
          'revenue', revenue,
          'cogs', case when v_can_cost then cogs else null end
        ) order by revenue desc)
        from (
          select category, sum(qty * price) as revenue, sum(qty * cost_price) as cogs
          from active_lines group by category
        ) c
      ), '[]'::jsonb),

      'soldByItem', coalesce((
        select jsonb_agg(jsonb_build_object('itemId', item_id, 'qty', qty))
        from (
          select item_id, sum(qty) as qty
          from active_lines where item_id is not null group by item_id
        ) s
      ), '[]'::jsonb),

      -- Range length in days (drives stock-health days-of-cover); for all-time,
      -- fall back to the first→last active-bill span, matching 0004.
      'daySpan', case
        when v_bounded then v_span
        else (
          select case
            when count(*) = 0 then 1
            else greatest(1, round(extract(epoch from (max(created_at) - min(created_at))) / 86400)::int + 1)
          end from active
        )
      end,

      'dowRevenue', coalesce((
        select jsonb_agg(jsonb_build_object('dow', dow, 'total', total))
        from (
          select extract(dow from local_ts)::int as dow, sum(total) as total
          from active group by extract(dow from local_ts)::int
        ) d
      ), '[]'::jsonb),

      'hourCounts', coalesce((
        select jsonb_agg(jsonb_build_object('hour', hour, 'count', cnt))
        from (
          select extract(hour from local_ts)::int as hour, count(*) as cnt
          from active group by extract(hour from local_ts)::int
        ) h
      ), '[]'::jsonb),

      'topEarner', (
        select jsonb_build_object('name', name, 'revenue', revenue)
        from (
          select name, sum(qty * price) as revenue
          from active_lines group by name order by sum(qty * price) desc limit 1
        ) e
      ),

      -- Newest 5 bills (any status), unfiltered by range — only for bill readers.
      'recentBills', case when not v_can_bills then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'billNo', bill_no, 'customerName', customer_name,
          'total', total, 'status', status, 'date', created_at
        ) order by created_at desc)
        from (
          select id, bill_no, customer_name, total, status, created_at
          from public.bills order by created_at desc limit 5
        ) r
      ), '[]'::jsonb) end

    )
  );
end $$;

grant execute on function public.dashboard_stats(text, date, date) to authenticated;
