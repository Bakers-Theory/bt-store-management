-- ============================================================================
-- BT Store Management — customer invoice types (GST / non-GST), part 1: schema
--
-- Design: docs/superpowers/specs/2026-08-05-customer-invoice-types-design.md
-- Plan:   docs/superpowers/plans/2026-08-06-customer-invoice-types.md
--
-- Sales in this app had no GST support: every bill applied a single store-wide
-- `store_settings.tax_rate` as an unnamed "Tax" line and printed as a thermal
-- slip. That is not a valid tax invoice — no customer GSTIN, no HSN, no
-- CGST/SGST/IGST split, no place of supply, no GST invoice series. The purchase
-- side already models GST (per-line gst_rate, suppliers.gstin), so the sales
-- side was the gap.
--
--   1. THE RATE LIVES ON THE ITEM, VIA HSN. A store-wide tax_rate cannot express
--      a basket of 0%, 5% and 18% goods, which is what a bakery actually sells.
--      tax_rate STAYS in the table so legacy bills keep their meaning, but no
--      new-bill path reads it (0069).
--   2. EVERY GST FIELD ON A BILL IS A SNAPSHOT, not a join. bill_items already
--      snapshots name and price for the same reason: an invoice is a statement
--      about a moment, and must not change when a master record does.
--   3. NEW COLUMNS DEFAULT TO NON-GST AND ZERO, so `alter table` IS the backfill.
--      Existing bills keep their stored tax untouched, get no invoice_no, and
--      print exactly as they do today.
--   4. CHARGED CONSUMABLES ARE TAXED LIKE ITEMS. A carry bag on a tax invoice is
--      a supply; it needs its own HSN and rate, not a blanket 0%. Absorbed lines
--      never reach the customer, so they need neither.
-- ============================================================================

-- ─── items: HSN and rate ────────────────────────────────────────────────────
alter table public.items
  add column if not exists hsn text not null default '',
  add column if not exists gst_rate numeric not null default 0;

alter table public.items drop constraint if exists items_gst_rate_range;
alter table public.items add constraint items_gst_rate_range
  check (gst_rate >= 0 and gst_rate <= 28);

-- ─── consumable: same, so a charged line can go on a tax invoice ────────────
alter table public.consumable
  add column if not exists hsn text not null default '',
  add column if not exists gst_rate numeric not null default 0;

alter table public.consumable drop constraint if exists consumable_gst_rate_range;
alter table public.consumable add constraint consumable_gst_rate_range
  check (gst_rate >= 0 and gst_rate <= 28);

-- ─── customers: who the invoice is addressed to ─────────────────────────────
alter table public.customers
  add column if not exists gstin text not null default '',
  add column if not exists state_code text not null default '',
  add column if not exists billing_address text not null default '',
  add column if not exists default_invoice_type text not null default 'non_gst';

alter table public.customers drop constraint if exists customers_default_invoice_type;
alter table public.customers add constraint customers_default_invoice_type
  check (default_invoice_type in ('gst','non_gst'));

-- ─── store_settings: the supplier's own particulars ─────────────────────────
-- `gst` (the store's GSTIN) and `address` already exist and are reused.
alter table public.store_settings
  add column if not exists gst_state_code text not null default '',
  add column if not exists prices_include_gst boolean not null default true;

-- ─── bills: the invoice header ──────────────────────────────────────────────
alter table public.bills
  add column if not exists invoice_type text not null default 'non_gst',
  add column if not exists invoice_no text,
  add column if not exists customer_gstin text not null default '',
  add column if not exists place_of_supply text not null default '',
  add column if not exists is_interstate boolean not null default false,
  add column if not exists taxable_value numeric not null default 0,
  add column if not exists cgst numeric not null default 0,
  add column if not exists sgst numeric not null default 0,
  add column if not exists igst numeric not null default 0;

alter table public.bills drop constraint if exists bills_invoice_type;
alter table public.bills add constraint bills_invoice_type
  check (invoice_type in ('gst','non_gst'));

-- The series must be unique, but legacy bills have none — hence a UNIQUE INDEX
-- over the non-null rows rather than a not-null unique constraint.
create unique index if not exists bills_invoice_no_uniq
  on public.bills (invoice_no) where invoice_no is not null;

-- `tax` remains the TOTAL tax, so `total`, the cash-book posting and analytics
-- are untouched by the split. Only enforced for GST rows: a legacy bill carries
-- a tax with no split behind it, and rewriting history is not the job here.
alter table public.bills drop constraint if exists bills_gst_split_sums;
alter table public.bills add constraint bills_gst_split_sums
  check (invoice_type <> 'gst' or tax = cgst + sgst + igst);

-- ─── bill_items / bill_consumable: the per-line snapshot ────────────────────
alter table public.bill_items
  add column if not exists hsn text not null default '',
  add column if not exists gst_rate numeric not null default 0,
  add column if not exists taxable_value numeric not null default 0,
  add column if not exists cgst numeric not null default 0,
  add column if not exists sgst numeric not null default 0,
  add column if not exists igst numeric not null default 0;

alter table public.bill_consumable
  add column if not exists hsn text not null default '',
  add column if not exists gst_rate numeric not null default 0,
  add column if not exists taxable_value numeric not null default 0,
  add column if not exists cgst numeric not null default 0,
  add column if not exists sgst numeric not null default 0,
  add column if not exists igst numeric not null default 0;

-- ─── invoice_counter: a per-year series a sequence cannot give us ───────────
-- A Postgres sequence cannot reset in April, and `max(invoice_no) + 1` races.
-- One upsert per bill, inside the bill's transaction (0069): a rolled-back bill
-- does not consume a number, so the series stays gapless.
create table if not exists public.invoice_counter (
  series  text not null check (series in ('gst','non_gst')),
  fy      text not null,
  next_no int  not null default 1,
  primary key (series, fy)
);
alter table public.invoice_counter enable row level security;
-- No policy, deliberately: only SECURITY DEFINER functions touch this table.

-- ─── items_v: carry the two new columns ─────────────────────────────────────
-- Reproduced from 0028; only the ADDED line is new.
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
    image_url,
    hsn, gst_rate                                    -- ADDED (0068)
  from public.items;
grant select on public.items_v to authenticated;

-- ─── bills_v: recreate so the new columns surface (b.* is frozen at create) ──
-- Reproduced from 0055; the predicate is unchanged.
drop view if exists public.bills_v;
create view public.bills_v as
  select b.*, p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('bill.history') or public.has_perm('bill.create')
     or public.has_perm('dashboard.view') or public.has_perm('reports.view');
grant select on public.bills_v to authenticated;

-- ─── consumable_v: two more columns, APPENDED ───────────────────────────────
-- Appended at the END rather than beside bill_mode: `create or replace view`
-- permits new trailing columns but not an insertion in the middle, and
-- consumable_alert_v selects from this view — dropping it would drag that one
-- along too. Reproduced from 0067 otherwise, verbatim.
create or replace view public.consumable_v as
select
  c.id, c.code, c.name, c.category, c.unit,
  c.bill_mode,
  c.vendor_id,
  coalesce(v.name, '') as vendor_name,
  c.min_stock, c.max_stock, c.reorder_level, c.reorder_qty,
  c.cost_per_unit,
  c.expiry_date, c.storage_location, c.notes,

  coalesce(l.current_stock, 0) as current_stock,
  l.last_purchase_date,
  l.last_purchase_cost,
  l.last_movement_date,

  -- The tier the list badges and the alerts both read.
  case
    when coalesce(l.current_stock, 0) <= 0 then 'out'
    when coalesce(l.current_stock, 0) < c.min_stock then 'low'
    when c.reorder_level is not null
         and coalesce(l.current_stock, 0) <= c.reorder_level then 'reorder'
    else 'ok'
  end as stock_status,

  -- §3.5: top up to the ceiling, or by the configured quantity, or back to the
  -- floor — the first of those that is actually configured.
  case
    when coalesce(l.current_stock, 0) >= c.min_stock
         and (c.reorder_level is null
              or coalesce(l.current_stock, 0) > c.reorder_level) then 0
    when c.reorder_qty is not null then c.reorder_qty
    when c.max_stock is not null then greatest(c.max_stock - coalesce(l.current_stock, 0), 0)
    else greatest(c.min_stock - coalesce(l.current_stock, 0), 0)
  end as recommended_qty,

  (c.expiry_date - public.store_today()) as expiry_days_left,

  -- Value on hand, at the latest purchase cost where there is one.
  round(coalesce(l.current_stock, 0)
        * coalesce(l.last_purchase_cost, c.cost_per_unit, 0), 2) as stock_value,

  c.created_at,
  coalesce(cb.name, '') as created_by_name,
  c.updated_at,
  coalesce(ub.name, '') as updated_by_name,

  c.hsn, c.gst_rate                                  -- ADDED (0068)
from public.consumable c
left join public.suppliers v on v.id = c.vendor_id
left join public.profiles cb on cb.id = c.created_by
left join public.profiles ub on ub.id = c.updated_by
left join lateral (
  select
    sum(m.qty_signed) as current_stock,
    max(m.on_date) as last_movement_date,
    max(m.on_date) filter (where m.movement_type = 'purchase') as last_purchase_date,
    (array_agg(m.unit_cost order by m.on_date desc, m.created_at desc)
       filter (where m.movement_type = 'purchase' and m.unit_cost is not null))[1]
      as last_purchase_cost
  from public.stock_movement m
  where m.consumable_id = c.id
) l on true
where c.deleted_at is null
  and public.has_perm('consumables.view');
grant select on public.consumable_v to authenticated;

-- ─── create_item / update_item: accept hsn and gstRate ──────────────────────
-- Reproduced from 0028 with the ADDED assignments. An absent key keeps the
-- default on create and the existing value on update, so a client that has not
-- shipped yet still saves items without blanking anything.
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
  insert into public.items (name, emoji, category, unit, price, cost_price, qty,
                            tracks_expiry, image_url,
                            hsn, gst_rate)                          -- ADDED (0068)
    values (p->>'name', coalesce(p->>'emoji','📦'), p->>'category', p->>'unit',
            coalesce((p->>'price')::numeric,0), coalesce((p->>'costPrice')::numeric,0),
            0, v_tracks, nullif(p->>'imageUrl',''),
            btrim(coalesce(p->>'hsn','')),                          -- ADDED (0068)
            coalesce((p->>'gstRate')::numeric, 0))                  -- ADDED (0068)
    returning id into v_id;
  if v_qty > 0 then
    perform public.add_batch(v_id, v_qty, v_expiry);
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values ('in', auth.uid(), v_id, p->>'name', v_qty, 'Initial stock');
  end if;
  select * into v_row from public.items_v where id = v_id;
  return jsonb_build_object('kind','added','id',v_id,'item',to_jsonb(v_row));
end $$;

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
    image_url = nullif(p->>'imageUrl',''),
    hsn = btrim(coalesce(p->>'hsn', hsn)),                    -- ADDED (0068)
    gst_rate = coalesce((p->>'gstRate')::numeric, gst_rate)   -- ADDED (0068)
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

-- ─── billable_consumables: the picker needs the rate to preview GST ─────────
-- Reproduced from 0067 with one ADDED line.
create or replace function public.billable_consumables()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb)
  from (
    select
      c.id, c.code, c.name, c.unit, c.bill_mode,
      c.hsn, c.gst_rate,                                    -- ADDED (0068)
      coalesce(c.cost_per_unit, 0) as cost_per_unit,
      coalesce((select sum(m.qty_signed) from public.stock_movement m
                 where m.consumable_id = c.id), 0) as current_stock
    from public.consumable c
    where c.deleted_at is null
      and c.bill_mode <> 'none'
      and (public.has_perm('bill.create') or public.has_perm('consumables.view'))
  ) t
$$;
grant execute on function public.billable_consumables() to authenticated;

-- ─── save_consumable: accept hsn and gstRate ────────────────────────────────
-- Reproduced from 0067 with two ADDED locals, one ADDED validation, and the two
-- columns on each of the update and the insert.
create or replace function public.save_consumable(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_old public.consumable;
  v_name text := btrim(coalesce(p->>'name',''));
  v_cat text := btrim(coalesce(p->>'category',''));
  v_unit text := btrim(coalesce(p->>'unit',''));
  v_vendor uuid := nullif(p->>'vendorId','')::uuid;
  v_min numeric := round(coalesce((p->>'minStock')::numeric, 0), 3);
  v_max numeric := round(nullif(p->>'maxStock','')::numeric, 3);
  v_reorder numeric := round(nullif(p->>'reorderLevel','')::numeric, 3);
  v_rqty numeric := round(nullif(p->>'reorderQty','')::numeric, 3);
  v_cost numeric := round(nullif(p->>'costPerUnit','')::numeric, 2);
  v_expiry date := nullif(p->>'expiryDate','')::date;
  v_bill_mode text := coalesce(nullif(p->>'billMode',''), 'none');
  v_hsn text := btrim(coalesce(p->>'hsn',''));                 -- ADDED (0068)
  v_gst numeric := coalesce((p->>'gstRate')::numeric, 0);      -- ADDED (0068)
begin
  if v_id is null then
    if not public.has_perm('consumables.create') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('consumables.edit') then raise exception 'forbidden'; end if;
  end if;

  if v_name = '' then raise exception 'this item needs a name'; end if;
  if not exists (select 1 from public.store_lists
                  where kind = 'consumable_category' and value = v_cat) then
    raise exception 'pick a category from the list';
  end if;
  if not exists (select 1 from public.store_lists where kind = 'unit' and value = v_unit) then
    raise exception 'pick a unit from the list';
  end if;
  if v_min < 0 then raise exception 'a minimum cannot be negative'; end if;
  if v_cost is not null and v_cost < 0 then
    raise exception 'a cost cannot be negative';
  end if;

  if v_bill_mode not in ('none','charge','absorb') then
    raise exception 'unknown billing mode "%"', v_bill_mode;
  end if;
  -- Note 2 of 0067: a charged line is priced from cost_per_unit, so marking an
  -- item chargeable without one would put a ₹0 line on a bill.
  if v_bill_mode = 'charge' and coalesce(v_cost, 0) <= 0 then
    raise exception 'set a cost per unit before charging this item on a bill';
  end if;

  -- ADDED (0068): the range the table constraint also enforces, said in words
  -- so the form shows a sentence rather than a constraint name.
  if v_gst < 0 or v_gst > 28 then
    raise exception 'a GST rate has to be between 0 and 28';
  end if;

  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;

  if exists (select 1 from public.consumable
              where name = v_name and unit = v_unit
                and deleted_at is null
                and (v_id is null or id <> v_id)) then
    raise exception '"% (%)" already exists', v_name, v_unit;
  end if;

  if v_id is not null then
    select * into v_old from public.consumable where id = v_id for update;
    if not found or v_old.deleted_at is not null then
      raise exception 'item not found';
    end if;
    -- Changing the unit under a ledger would silently reinterpret every past
    -- movement: 5 kg becoming 5 litres. Retire the item and open a new one.
    if v_old.unit <> v_unit
       and exists (select 1 from public.stock_movement where consumable_id = v_id) then
      raise exception
        'this item already has stock movements in %, so its unit cannot change',
        v_old.unit;
    end if;

    update public.consumable set
      name = v_name, category = v_cat, unit = v_unit, vendor_id = v_vendor,
      min_stock = v_min, max_stock = v_max, reorder_level = v_reorder,
      reorder_qty = v_rqty, cost_per_unit = v_cost,
      expiry_date = v_expiry,
      bill_mode = v_bill_mode,
      hsn = v_hsn, gst_rate = v_gst,                          -- ADDED (0068)
      storage_location = btrim(coalesce(p->>'storageLocation','')),
      notes = btrim(coalesce(p->>'notes','')),
      updated_by = auth.uid()
    where id = v_id;

    insert into public.activity_log (type, actor, item_name, notes)
      values ('consumable', auth.uid(), v_name, 'Edited item ' || v_old.code);

    return v_id;
  end if;

  insert into public.consumable (
    name, category, unit, vendor_id,
    min_stock, max_stock, reorder_level, reorder_qty, cost_per_unit,
    expiry_date, bill_mode,
    hsn, gst_rate,                                            -- ADDED (0068)
    storage_location, notes, created_by, updated_by)
  values (
    v_name, v_cat, v_unit, v_vendor,
    v_min, v_max, v_reorder, v_rqty, v_cost,
    v_expiry, v_bill_mode,
    v_hsn, v_gst,                                             -- ADDED (0068)
    btrim(coalesce(p->>'storageLocation','')),
    btrim(coalesce(p->>'notes','')), auth.uid(), auth.uid())
  returning id into v_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('consumable', auth.uid(), v_name,
            'Added item ' || (select code from public.consumable where id = v_id)
            || ' (' || v_cat || ')');

  return v_id;
end $$;
grant execute on function public.save_consumable(jsonb) to authenticated;

-- ─── save_settings: the store's own state code and pricing convention ───────
-- Reproduced from 0028 with two ADDED assignments. tax_rate stays writable and
-- now COALESCES TO ITSELF rather than to 0: the Settings UI stops sending it,
-- and an absent key must leave a legacy rate alone rather than zero it.
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
    tax_rate = coalesce((p->>'taxRate')::numeric, tax_rate),          -- CHANGED
    low_stock_alert = coalesce((p->>'lowStockAlert')::numeric,5),
    expiring_soon_days = coalesce((p->>'expiringSoonDays')::integer,3),
    gst_state_code = btrim(coalesce(p->>'gstStateCode', gst_state_code)),  -- ADDED
    prices_include_gst =
      coalesce((p->>'pricesIncludeGst')::boolean, prices_include_gst)      -- ADDED
  where id = 1;
  insert into public.activity_log (type, actor, notes)
    values ('settings', auth.uid(), 'Updated store settings');
end $$;

-- ─── customers: read and write the new fields ───────────────────────────────
-- update_customer takes a jsonb now: four more fields would have made a
-- six-argument positional call that is easy to get wrong at the call site. The
-- old three-argument signature is DROPPED so PostgREST is not left choosing
-- between two overloads.
drop function if exists public.update_customer(uuid, text, text);

create or replace function public.update_customer(p_id uuid, p jsonb)
returns public.customers language plpgsql security definer set search_path = public as $$
declare v_row public.customers;
        v_phone text := nullif(btrim(p->>'phone'), '');
        v_gstin text := upper(btrim(coalesce(p->>'gstin','')));
        v_type  text := coalesce(nullif(p->>'defaultInvoiceType',''), 'non_gst');
begin
  if not public.has_perm('customers.edit') then raise exception 'forbidden'; end if;
  if v_phone is null then raise exception 'Phone number is required'; end if;
  if v_type not in ('gst','non_gst') then raise exception 'unknown invoice type'; end if;
  -- Format only; the check-digit algorithm is out of scope by design.
  if v_gstin <> '' and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
    raise exception 'that GSTIN does not look right';
  end if;

  update public.customers
    set name = coalesce(p->>'name', ''),
        phone = v_phone,
        gstin = v_gstin,
        -- A blank state code falls back to the GSTIN's own first two digits, so
        -- the two can never contradict each other by omission.
        state_code = coalesce(nullif(btrim(p->>'stateCode'), ''), left(v_gstin, 2)),
        billing_address = btrim(coalesce(p->>'billingAddress','')),
        default_invoice_type = v_type
    where id = p_id
    returning * into v_row;
  if not found then raise exception 'Customer not found'; end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'Another customer already uses that phone number';
end $$;
grant execute on function public.update_customer(uuid, jsonb) to authenticated;

-- Both readers gain the same four columns. Reproduced from 0028 otherwise.
-- Dropped rather than replaced: the return type changes, which
-- `create or replace function` refuses.
drop function if exists public.customers_with_stats();
create or replace function public.customers_with_stats()
returns table (
  id                   uuid,
  phone                text,
  name                 text,
  first_seen           timestamptz,
  visit_count          bigint,
  total_spend          numeric,
  last_purchase        timestamptz,
  gstin                text,
  state_code           text,
  billing_address      text,
  default_invoice_type text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.phone, c.name, c.first_seen,
         count(b.id) filter (where b.status = 'active')            as visit_count,
         coalesce(sum(b.total) filter (where b.status = 'active'), 0) as total_spend,
         max(b.created_at) filter (where b.status = 'active')      as last_purchase,
         c.gstin, c.state_code, c.billing_address, c.default_invoice_type
  from public.customers c
  left join public.bills b on b.customer_id = c.id
  where public.has_perm('customers.view')
  group by c.id
$$;
grant execute on function public.customers_with_stats() to authenticated;

drop function if exists public.customer_by_phone(text);
create or replace function public.customer_by_phone(p_phone text)
returns table (
  id                   uuid,
  phone                text,
  name                 text,
  first_seen           timestamptz,
  visit_count          bigint,
  total_spend          numeric,
  last_purchase        timestamptz,
  gstin                text,
  state_code           text,
  billing_address      text,
  default_invoice_type text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.phone, c.name, c.first_seen,
         count(b.id) filter (where b.status = 'active')            as visit_count,
         coalesce(sum(b.total) filter (where b.status = 'active'), 0) as total_spend,
         max(b.created_at) filter (where b.status = 'active')      as last_purchase,
         c.gstin, c.state_code, c.billing_address, c.default_invoice_type
  from public.customers c
  left join public.bills b on b.customer_id = c.id
  where c.phone = p_phone
    and (public.has_perm('customers.view') or public.has_perm('bill.create'))
  group by c.id
$$;
grant execute on function public.customer_by_phone(text) to authenticated;
