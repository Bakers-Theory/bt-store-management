-- ============================================================================
-- BT Store Management — consumables on a bill
--
-- A carry bag handed over with an order is stock leaving the shelf at the
-- counter. Until now the only way to record that was `record_stock_movement`,
-- which needs `consumables.issue` — a permission billers do not hold — so it
-- was recorded late, by hand, or not at all.
--
--   1. SHOWING IT ON THE BILL AND CHARGING FOR IT ARE THE SAME DECISION. One
--      boolean, `bill_consumable.charged`. Two independent switches would allow
--      a line the customer pays for but cannot see, and a line printed at a
--      price that never reaches the total. The receipt is therefore always a
--      truthful statement of what was charged.
--   2. CHARGED AT COST, WITH NO SELLING PRICE. `consumable.cost_per_unit`, not
--      `last_purchase_cost` — a master field the operator sets, so what a
--      customer is charged does not shift when a purchase is recorded. Revenue
--      and COGS then move by the same amount and margin is unaffected.
--   3. A CHARGED LINE IS TAXED AND DISCOUNTED LIKE AN ITEM LINE, because it is
--      inside `bills.subtotal`. One totals path. A percent discount does take a
--      bag slightly below cost; that is accepted over a second path that would
--      have to be kept in step with the first.
--   4. THE ABSORBED COST POSTS TO THE CASH BOOK, REVERSING 0066 NOTE 3 FOR THIS
--      PATH ONLY. That note refuses to post an issue, on the grounds that the
--      money left when the stock was bought. That holds only if the purchase was
--      expensed. In this store it is not — consumable purchases are recorded as
--      stock alone (0066 note 2's supported path) — so this posting is the only
--      record of the spend, not a second one. IF CONSUMABLE PURCHASES EVER START
--      CARRYING AN `expense` BLOCK, THIS BECOMES A DOUBLE-COUNT AND MUST BE
--      REVISITED.
--   5. NOT IN bill_items. `cashbook_cogs` (0053), `bill_lines_with_cost` and
--      `excel.ts` all read that table assuming every row is a catalogue item
--      with an `item_id`. Widening it would silently change all three.
--   6. bill_mode DEFAULTS TO 'none', so no existing consumable appears at the
--      counter until it is deliberately marked. Raw sugar and cleaning fluid
--      have no business in a biller's search.
--   7. NOTHING IS STORED THAT CAN BE DERIVED (0062 note 1). There is no
--      `consumable_charged` total on `bills`; the sums come from
--      `bill_consumable`. `bills.subtotal` is the exception, and it already was.
--
-- Applies on top of 0066.
-- ============================================================================

-- ─── consumable.bill_mode (note 6) ──────────────────────────────────────────
alter table public.consumable
  add column if not exists bill_mode text not null default 'none';

alter table public.consumable drop constraint if exists consumable_bill_mode_check;
alter table public.consumable add constraint consumable_bill_mode_check
  check (bill_mode in ('none','charge','absorb'));

-- ─── bill_consumable (note 5) ───────────────────────────────────────────────
-- `name`, `unit` and `unit_cost` are snapshots, the way bill_items already
-- snapshots them: a reprinted bill must show what was charged, not what the item
-- happens to be called today.
create table if not exists public.bill_consumable (
  id                uuid primary key default gen_random_uuid(),
  bill_id           uuid not null references public.bills(id) on delete cascade,
  -- Set null, not cascade: the line outlives a consumable removed from the
  -- master, the same way bill_items.item_id does.
  consumable_id     uuid references public.consumable(id) on delete set null,
  -- The ledger entry this line created, so the consumables module can answer
  -- "which bill took this stock" without a text search on remarks.
  stock_movement_id uuid references public.stock_movement(id),

  name              text not null,
  unit              text not null,
  qty               numeric(12,3) not null check (qty > 0),
  unit_cost         numeric(12,2) not null default 0 check (unit_cost >= 0),
  -- Note 1: printed AND charged, or neither.
  charged           boolean not null,
  line_no           int not null,

  -- A charged line at no cost is not "charged", it is free. generate_bill
  -- rejects it too; this is the backstop.
  constraint bill_consumable_charged_has_cost
    check (not charged or unit_cost > 0)
);

create index if not exists bill_consumable_bill_idx
  on public.bill_consumable (bill_id, line_no);
create index if not exists bill_consumable_item_idx
  on public.bill_consumable (consumable_id);
create unique index if not exists bill_consumable_line_uniq
  on public.bill_consumable (bill_id, line_no);

-- Read for anyone who may see bills; writes only through generate_bill, which is
-- SECURITY DEFINER. The predicate is copied from bills_v (0055).
alter table public.bill_consumable enable row level security;
drop policy if exists bill_consumable_read on public.bill_consumable;
create policy bill_consumable_read on public.bill_consumable for select
  using (public.has_perm('bill.history') or public.has_perm('bill.create')
         or public.has_perm('dashboard.view') or public.has_perm('reports.view'));

-- ─── The category the absorbed cost posts to (note 4) ───────────────────────
-- System, because generate_bill names it on the auto-posting path: an admin
-- archiving it would break checkout. Top-level and childless, so it is a valid
-- posting target (0044 note 3).
insert into public.cash_category (name, direction, is_system, sort_order) values
  ('Consumables Used', 'out', true, 9)
on conflict do nothing;

-- ─── Let one bill post two DIFFERENT `out` entries ──────────────────────────
-- 0056 widened this key by `direction` because 0055 made a short-paid bill post
-- both in and out. An absorbed consumable is a SECOND `out` on the same bill and
-- the same account, so under the 0056 key it raises `duplicate key value
-- violates unique constraint` and rolls the whole checkout back — every
-- short-paid bill carrying an absorbed consumable would fail.
--
-- Adding category_id is 0056's own argument one level further, and the index
-- still catches what it exists to catch: the same posting written twice. Two
-- postings that differ only by category are, by construction, two different
-- things — Payment Shortfall is not Consumables Used.
drop index if exists public.cash_entry_source_uniq;
create unique index if not exists cash_entry_source_uniq
  on public.cash_entry (source_type, source_id, account, direction, category_id)
  where source_id is not null and reverses_id is null and deleted_at is null;

-- ─── consumable_v: surface bill_mode ───────────────────────────────────────
-- Reproduced from 0062 with one ADDED line. A view's column list is frozen at
-- create time, hence the drop. consumable_alert_v selects from this view, so it
-- goes with it and is reproduced from 0062 unchanged.
drop view if exists public.consumable_alert_v;
drop view if exists public.consumable_v;

create or replace view public.consumable_v as
select
  c.id, c.code, c.name, c.category, c.unit,
  c.bill_mode,                                  -- ADDED (0067)
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
  coalesce(ub.name, '') as updated_by_name
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

-- Reproduced from 0062 unchanged; it only had to be dropped because it depends
-- on consumable_v.
create or replace view public.consumable_alert_v as
with usage as (
  select
    m.consumable_id,
    coalesce(sum(-m.qty_signed) filter (
      where m.qty_signed < 0
        and m.on_date > public.store_today() - 30), 0) as recent_out,
    -- The 90 days ending where `recent_out` begins: three windows, hence /3.
    coalesce(sum(-m.qty_signed) filter (
      where m.qty_signed < 0
        and m.on_date <= public.store_today() - 30
        and m.on_date > public.store_today() - 120), 0) as prior_out
  from public.stock_movement m
  group by m.consumable_id
)
select * from (
  select
    c.id as consumable_id, c.code, c.name, c.unit, c.current_stock,
    'out_of_stock' as alert, 2 as severity,
    'Out of stock' as message
  from public.consumable_v c where c.stock_status = 'out'

  union all
  select c.id, c.code, c.name, c.unit, c.current_stock,
    'low_stock', 2,
    'Below the minimum of ' || trim(to_char(c.min_stock, 'FM9999990.999'))
  from public.consumable_v c where c.stock_status = 'low'

  union all
  select c.id, c.code, c.name, c.unit, c.current_stock,
    'reorder', 1,
    'At the reorder level'
  from public.consumable_v c where c.stock_status = 'reorder'

  union all
  select c.id, c.code, c.name, c.unit, c.current_stock,
    'expired', 2,
    'Expired ' || abs(c.expiry_days_left)::text || ' day(s) ago'
  from public.consumable_v c
  where c.expiry_days_left is not null and c.expiry_days_left < 0
    and c.current_stock > 0

  union all
  select c.id, c.code, c.name, c.unit, c.current_stock,
    'expiring', 1,
    'Expires in ' || c.expiry_days_left::text || ' day(s)'
  from public.consumable_v c
  where c.expiry_days_left is not null
    and c.expiry_days_left between 0 and 30
    and c.current_stock > 0

  union all
  select c.id, c.code, c.name, c.unit, c.current_stock,
    'high_consumption', 1,
    'Used ' || trim(to_char(u.recent_out, 'FM9999990.999'))
      || ' in 30 days against a usual '
      || trim(to_char(round(u.prior_out / 3, 3), 'FM9999990.999'))
  from public.consumable_v c
  join usage u on u.consumable_id = c.id
  where u.prior_out > 0
    and u.recent_out > 1.5 * (u.prior_out / 3)
) a
where public.has_perm('consumables.view');

grant select on public.consumable_v to authenticated;
grant select on public.consumable_alert_v to authenticated;

-- ─── billable_consumables: the picker's read surface ───────────────────────
-- consumable_v needs `consumables.view`, which a biller does not hold, so the
-- picker would come back empty. SECURITY DEFINER and gated on bill.create,
-- returning only the fields the cart needs — not the vendor, the notes or the
-- reorder settings.
--
-- `current_stock` is the ledger sum, computed here rather than read from
-- consumable_v so this function does not depend on that view's permission
-- predicate.
create or replace function public.billable_consumables()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb)
  from (
    select
      c.id, c.code, c.name, c.unit, c.bill_mode,
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

-- ─── save_consumable: accept billMode ──────────────────────────────────────
-- Reproduced from 0063 with four ADDED blocks.
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
  v_bill_mode text := coalesce(nullif(p->>'billMode',''), 'none');   -- ADDED (0067)
begin
  if v_id is null then
    if not public.has_perm('consumables.create') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('consumables.edit') then raise exception 'forbidden'; end if;
  end if;

  if v_name = '' then raise exception 'this item needs a name'; end if;
  if not exists (select 1 from public.store_lists
                  where kind = 'consumable_category' and value = v_cat) then
    raise exception 'choose a category';
  end if;
  -- Units are the shared list (0062 note 5), so an unknown one is a typo.
  if not exists (select 1 from public.store_lists
                  where kind = 'unit' and value = v_unit) then
    raise exception 'choose a unit';
  end if;
  if v_min < 0 then raise exception 'a minimum stock cannot be negative'; end if;
  if v_max is not null and v_max < v_min then
    raise exception 'the maximum stock cannot be below the minimum';
  end if;
  if v_reorder is not null and v_max is not null and v_reorder > v_max then
    raise exception 'the reorder level cannot be above the maximum stock';
  end if;
  if v_rqty is not null and v_rqty <= 0 then
    raise exception 'a reorder quantity has to be more than zero';
  end if;
  if v_cost is not null and v_cost < 0 then
    raise exception 'a cost cannot be negative';
  end if;

  -- ADDED (0067)
  if v_bill_mode not in ('none','charge','absorb') then
    raise exception 'unknown billing mode "%"', v_bill_mode;
  end if;
  -- Note 2: a charged line is priced from cost_per_unit, so marking an item
  -- chargeable without one would put a ₹0 line on a bill.
  if v_bill_mode = 'charge' and coalesce(v_cost, 0) <= 0 then
    raise exception 'set a cost per unit before charging this item on a bill';
  end if;

  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;

  -- The unique constraint is (name, unit); say so in words rather than letting
  -- the index speak.
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
      bill_mode = v_bill_mode,                            -- ADDED (0067)
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
    expiry_date, bill_mode, storage_location, notes, created_by, updated_by)
  values (
    v_name, v_cat, v_unit, v_vendor,
    v_min, v_max, v_reorder, v_rqty, v_cost,
    v_expiry, v_bill_mode, btrim(coalesce(p->>'storageLocation','')),
    btrim(coalesce(p->>'notes','')), auth.uid(), auth.uid())
  returning id into v_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('consumable', auth.uid(), v_name,
            'Added item ' || (select code from public.consumable where id = v_id)
            || ' (' || v_cat || ')');

  return v_id;
end $$;

grant execute on function public.save_consumable(jsonb) to authenticated;

-- ─── issue_consumable_for_bill: the counter's way into the ledger ───────────
-- record_stock_movement (0063) checks `consumables.issue`, which a biller does
-- not hold, so the billing path cannot go through it. This helper is the
-- billing path's equivalent: it takes the SAME row lock and runs the SAME
-- negative-stock check (0063 note 2), so the guarantee is identical and the
-- check lives in one place rather than being copy-pasted into generate_bill
-- where it could drift.
--
-- No permission check of its own: it is not granted to `authenticated` and is
-- only ever called from generate_bill, which has already checked bill.create.
create or replace function public.issue_consumable_for_bill(
  p_consumable_id uuid,
  p_qty           numeric,
  p_on_date       date,
  p_bill_no       bigint
)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.consumable; v_before numeric; v_id uuid; v_qty numeric;
begin
  v_qty := round(coalesce(p_qty, 0), 3);
  if v_qty <= 0 then raise exception 'a quantity has to be more than zero'; end if;

  select * into c from public.consumable where id = p_consumable_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'that consumable no longer exists';
  end if;
  -- Note 6: only what the operator put at the counter.
  if c.bill_mode = 'none' then
    raise exception '"%" is not available at billing', c.name;
  end if;

  -- Computed under the lock taken above, so two concurrent bills cannot both
  -- take the last bag.
  select coalesce(sum(qty_signed), 0) into v_before
    from public.stock_movement where consumable_id = p_consumable_id;

  if v_before - v_qty < 0 then
    raise exception 'there is only % % of % on hand',
      trim(to_char(v_before, 'FM9999990.999')), c.unit, c.name;
  end if;

  insert into public.stock_movement (
    consumable_id, movement_type, qty, on_date, reason, remarks, created_by)
  values (
    p_consumable_id, 'issue', v_qty, p_on_date, '',
    'Issued on bill #' || p_bill_no, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function
  public.issue_consumable_for_bill(uuid, numeric, date, bigint) from public;

-- ─── bill_payload: carry the consumable lines ──────────────────────────────
-- Reproduced from 0031 with one ADDED key, so the receipt renders from stored
-- rows rather than from the caller's cart. Absorbed lines are included — the
-- client needs them to show what the bill cost the store — and Receipt.tsx is
-- what filters them out of the print. cost_price stays out, as in 0031.
create or replace function public.bill_payload(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bill', to_jsonb(b) - 'client_ref' || jsonb_build_object('biller_name', p.name),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bi.id, 'bill_id', bi.bill_id, 'item_id', bi.item_id,
               'name', bi.name, 'emoji', bi.emoji, 'image_url', bi.image_url,
               'unit', bi.unit, 'qty', bi.qty, 'price', bi.price
             ) order by bi.line_no nulls last, bi.name)
      from public.bill_items bi where bi.bill_id = b.id), '[]'::jsonb),
    -- ADDED (0067)
    'consumables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bc.id, 'consumable_id', bc.consumable_id,
               'name', bc.name, 'unit', bc.unit, 'qty', bc.qty,
               'unit_cost', bc.unit_cost, 'charged', bc.charged
             ) order by bc.line_no)
      from public.bill_consumable bc where bc.bill_id = b.id), '[]'::jsonb)
  )
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where b.id = p_id
$$;
revoke execute on function public.bill_payload(uuid) from public;

-- ─── generate_bill: consumables at the counter ─────────────────────────────
-- Reproduced from 0055. The argument list gains p_consumables, so the old
-- signature has to go: an overload set with a defaulted parameter makes
-- PostgREST ambiguous about which to call.
--
-- p_consumables IS DEFAULTED, so a client that has not shipped yet still
-- resolves to this function and bills with no consumables. That makes
-- migration-first deployment safe; client-first is not.
drop function if exists public.generate_bill(jsonb, jsonb, text, uuid);

create or replace function public.generate_bill(
  customer jsonb, lines jsonb, p_tz text default 'UTC',
  p_client_ref uuid default null, p_consumables jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric; v_no int := 0;
        v_type text; v_disc numeric := 0; v_amt numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
        v_existing uuid;
        v_recv numeric; v_short numeric := 0; v_snote text := ''; v_note text;
        -- ADDED (0067)
        cn jsonb; cc public.consumable; v_cqty numeric; v_cno int := 0;
        v_charged boolean; v_ccost numeric;
        v_csub numeric := 0; v_absorbed numeric := 0; v_mv uuid;
        v_on date;
begin
  if not public.has_perm('bill.create') then raise exception 'forbidden'; end if;
  -- A biller without bill.discount cannot smuggle one in through the payload.
  if coalesce((customer->>'discount')::numeric, 0) > 0
     and not public.has_perm('bill.discount') then
    raise exception 'not allowed to apply a discount';
  end if;

  -- A retried checkout — the bill committed but the response was lost on the
  -- way back — must return the bill that already exists, not ring up a second.
  if p_client_ref is not null then
    select id into v_existing from public.bills where client_ref = p_client_ref;
    if found then return public.bill_payload(v_existing); end if;
  end if;

  if not (select is_open from public.store_settings where id = 1) then
    raise exception 'Store is closed — new bills cannot be created';
  end if;

  v_on := (now() at time zone p_tz)::date;
  perform public.assert_cash_day_open(v_on);

  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;

  -- ADDED (0067): price and validate every consumable line BEFORE the bill row
  -- exists, so a line over stock fails cheaply. The `for update` lock taken here
  -- is held to commit, which is what makes the check in
  -- issue_consumable_for_bill hold under concurrency.
  for cn in select * from jsonb_array_elements(p_consumables) loop
    v_cqty := round(coalesce((cn->>'qty')::numeric, 0), 3);
    v_charged := coalesce((cn->>'charged')::boolean, false);
    select * into cc from public.consumable
      where id = (cn->>'consumableId')::uuid for update;
    if not found or cc.deleted_at is not null then
      raise exception 'that consumable no longer exists';
    end if;
    if cc.bill_mode = 'none' then
      raise exception '"%" is not available at billing', cc.name;
    end if;
    if v_cqty <= 0 then raise exception 'a quantity has to be more than zero'; end if;

    -- Note 2: cost_per_unit is the price, so a charged line needs one.
    v_ccost := coalesce(cc.cost_per_unit, 0);
    if v_charged and v_ccost <= 0 then
      raise exception 'set a cost per unit on % before charging it on a bill', cc.name;
    end if;

    -- Note 3: charged lines join the subtotal and are taxed and discounted with
    -- everything else. Absorbed lines are money the store spends, not money the
    -- customer pays, so they stay out of it.
    if v_charged then
      v_csub := v_csub + v_cqty * v_ccost;
    else
      v_absorbed := v_absorbed + v_cqty * v_ccost;
    end if;
  end loop;

  v_sub := round(v_sub + v_csub, 2);          -- CHANGED (0067): + v_csub
  v_absorbed := round(v_absorbed, 2);

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

  begin
    insert into public.bills (customer_name, customer_phone, customer_id,
                              subtotal, tax, total, tax_rate, payment_method,
                              discount_percent, discount_type, discount_amount,
                              created_by, client_ref)
      values (coalesce(customer->>'name',''), v_phone, v_customer,
              v_sub, v_tax, round(v_taxable + v_tax, 2), v_rate,
              case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
              v_disc, v_type, v_amt, auth.uid(), p_client_ref)
      returning * into v_bill;
  exception when unique_violation then
    -- client_ref is the only unique constraint this insert can hit; anything
    -- else is a real error and must not be swallowed as a replay.
    if p_client_ref is null then raise; end if;
    -- Two retries raced past the check above; the one that committed wins and
    -- no stock is consumed on this path.
    select id into v_existing from public.bills where client_ref = p_client_ref;
    return public.bill_payload(v_existing);
  end;

  for ln in select * from jsonb_array_elements(lines) loop
    v_no := v_no + 1;
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty,
                                   price, cost_price, image_url, line_no)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty,
              it.price, it.cost_price, it.image_url, v_no);
    perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
  end loop;

  -- ADDED (0067): the stock leaves, and the line is stored with a snapshot of
  -- what it was called and what it cost.
  for cn in select * from jsonb_array_elements(p_consumables) loop
    v_cno := v_cno + 1;
    v_cqty := round(coalesce((cn->>'qty')::numeric, 0), 3);
    v_charged := coalesce((cn->>'charged')::boolean, false);
    select * into cc from public.consumable where id = (cn->>'consumableId')::uuid;
    v_mv := public.issue_consumable_for_bill(cc.id, v_cqty, v_on, v_bill.bill_no);
    insert into public.bill_consumable (
      bill_id, consumable_id, stock_movement_id, name, unit, qty,
      unit_cost, charged, line_no)
    values (
      v_bill.id, cc.id, v_mv, cc.name, cc.unit, v_cqty,
      coalesce(cc.cost_per_unit, 0), v_charged, v_cno);
  end loop;

  -- The gap, derived from the STORED total. nullif, not a plain coalesce — ''
  -- would raise on the ::numeric cast. An absent, blank or over-the-total
  -- `received` all mean "paid in full".
  v_recv  := coalesce(nullif(customer->>'received', '')::numeric, v_bill.total);
  v_short := least(v_bill.total, greatest(0, round(v_bill.total - v_recv, 2)));
  if v_short > 0 then
    v_snote := left(btrim(coalesce(customer->>'shortfallNote', '')), 200);
    update public.bills set shortfall = v_short, shortfall_note = v_snote
      where id = v_bill.id
      returning * into v_bill;
  end if;

  -- The sale posts to the ledger. A zero-total bill (a full discount) moved no
  -- money, so it posts nothing — post_cash requires amount > 0. The charged
  -- consumables are already inside v_bill.total, so this one posting still
  -- covers the whole sale.
  if v_bill.total > 0 then
    perform public.post_cash(
      v_on, 'in', v_bill.total, v_bill.payment_method,
      public.system_category('Sales'), 'bill', v_bill.id,
      '', '', null, null);
  end if;

  -- ADDED (0067): what the store spent on the lines the customer never saw.
  -- Same date and mode as the sale, the shape 0055 uses for the shortfall. This
  -- is the SECOND `out` posting a bill can make, which is why the unique index
  -- had to gain category_id.
  if v_absorbed > 0 then
    perform public.post_cash(
      v_on, 'out', v_absorbed, v_bill.payment_method,
      public.system_category('Consumables Used'), 'bill', v_bill.id,
      'Consumables used on bill #' || v_bill.bill_no, '', null, null);
  end if;

  -- And the loss goes straight back out, same date and mode, so Sales stays
  -- equal to the sum of bill totals while the day nets to the cash actually
  -- taken. post_cash rejects a non-positive amount, hence the guard.
  if v_short > 0 then
    v_note := 'Short payment on bill #' || v_bill.bill_no
              || case when v_snote <> '' then ' — ' || v_snote else '' end;
    perform public.post_cash(
      v_on, 'out', v_short, v_bill.payment_method,
      public.system_category('Payment Shortfall'), 'bill', v_bill.id,
      v_note, '', null, null);
  end if;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ' order by line_no) from public.bill_items
              where bill_id = v_bill.id),
            v_bill.total);
  return public.bill_payload(v_bill.id);
end $$;
grant execute on function
  public.generate_bill(jsonb, jsonb, text, uuid, jsonb) to authenticated;

-- ─── return_bill_consumables: stock comes back as an entry ─────────────────
-- The ledger is append-only (0062 note 2), so a cancelled bill's consumables
-- return as `return` movements rather than by deleting the issues. Idempotent
-- on the movement, not on the bill: a line whose return already exists is
-- skipped, so a cancel-then-delete cannot return the same stock twice.
create or replace function public.return_bill_consumables(p_bill_id uuid, p_why text)
returns int language plpgsql security definer set search_path = public as $$
declare bc public.bill_consumable; v_no bigint; v_n int := 0;
begin
  select bill_no into v_no from public.bills where id = p_bill_id;

  for bc in select * from public.bill_consumable where bill_id = p_bill_id
             order by line_no loop
    if bc.consumable_id is null then continue; end if;
    -- Already returned by an earlier cancel.
    if exists (select 1 from public.stock_movement m
                where m.consumable_id = bc.consumable_id
                  and m.movement_type = 'return'
                  and m.remarks = 'Returned from bill #' || v_no || ' line ' || bc.line_no)
    then continue; end if;

    insert into public.stock_movement (
      consumable_id, movement_type, qty, on_date, reason, remarks, created_by)
    values (
      bc.consumable_id, 'return', bc.qty, public.store_today(), '',
      'Returned from bill #' || v_no || ' line ' || bc.line_no, auth.uid());
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
revoke execute on function public.return_bill_consumables(uuid, text) from public;

-- ─── cancel_bill / delete_bill: the consumables come back too ──────────────
-- Reproduced from 0047 with one ADDED line each. The MONEY needs no change:
-- reverse_cash loops every entry for the bill, so the Consumables Used posting
-- reverses alongside Sales and Payment Shortfall.
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

  -- ADDED (0067)
  perform public.return_bill_consumables(p_id, 'cancelled by ' || p_by);

  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id;

  -- The money goes back. If the sale's day is closed the reversal lands on the
  -- current open day instead of rewriting a counted day (phase B).
  perform public.reverse_cash('bill', p_id, 'cancelled by ' || p_by);

  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('cancel', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Cancelled by ' || p_by);
end $$;

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
    -- ADDED (0067): only for a bill not already cancelled, mirroring the batch
    -- restore above. return_bill_consumables is idempotent anyway.
    perform public.return_bill_consumables(p_id, 'deleted by ' || p_by);
  end if;

  -- BEFORE the delete: an already-cancelled bill was reversed by cancel_bill,
  -- and reverse_cash is idempotent, so this is a no-op there. The ledger rows
  -- survive the bill: source_id is deliberately not a FK.
  perform public.reverse_cash('bill', p_id, 'deleted by ' || p_by);

  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('delete', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Deleted by ' || p_by);
  delete from public.bills where id = p_id;   -- cascades bill_items
end $$;

-- ─── cashbook_cogs: charged consumables cost something too ─────────────────
-- Reproduced from 0053 with one ADDED term. Without it a bill that charged for
-- a carry bag reads as 100% margin on that line. Since they are charged at cost
-- (note 2), the revenue and the cost cancel — which is the honest result.
-- Absorbed lines are NOT here: the customer paid nothing for them, so they are
-- not a cost of goods sold. Their cost is already in the cash book.
create or replace function public.cashbook_cogs(p_from date, p_to date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_cogs numeric; v_cons numeric;
begin
  -- Note 2 of 0053: absent, not zero.
  if not public.has_perm('dashboard.profit') then return null; end if;

  select timezone into v_tz from public.store_settings where id = 1;

  select coalesce(round(sum(bi.qty * coalesce(bi.cost_price, 0)), 2), 0)
    into v_cogs
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  where b.status = 'active'
    and (p_from is null or (b.created_at at time zone v_tz)::date >= p_from)
    and (p_to   is null or (b.created_at at time zone v_tz)::date <= p_to);

  -- ADDED (0067)
  select coalesce(round(sum(bc.qty * bc.unit_cost), 2), 0)
    into v_cons
  from public.bill_consumable bc
  join public.bills b on b.id = bc.bill_id
  where b.status = 'active'
    and bc.charged
    and (p_from is null or (b.created_at at time zone v_tz)::date >= p_from)
    and (p_to   is null or (b.created_at at time zone v_tz)::date <= p_to);

  return round(v_cogs + v_cons, 2);
end $$;

grant execute on function public.cashbook_cogs(date, date) to authenticated;
