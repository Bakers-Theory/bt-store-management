-- ============================================================================
-- BT Store Management — consumables & the stock ledger (#91, module 2 of 2)
--
--   1. CURRENT STOCK IS DERIVED, NEVER STORED. §3.2 says so and AC-2 tests it:
--      "Current Stock always matches the sum of the ledger". There is therefore
--      no `current_stock` column to drift — `consumable_v.current_stock` is the
--      sum of `stock_movement.qty_signed`, and record_stock_movement (0063)
--      computes the same sum under a row lock before allowing a movement.
--   2. THE LEDGER IS APPEND-ONLY, LIKE cash_entry (0045). Triggers refuse every
--      DELETE and every UPDATE outright; §3.3 asks for corrections as offsetting
--      Adjustment entries, which is the same discipline the cashbook already uses
--      for money.
--   3. `qty` IS ALWAYS POSITIVE EXCEPT ON AN ADJUSTMENT. The direction belongs to
--      the movement *type*, not to the sign a user typed — Wastage of 5 and Issue
--      of 5 both take 5 out. Only `adjustment` may be negative, because a stock
--      count can go either way. `qty_signed` is generated from the pair, so every
--      reader agrees on the direction.
--   4. A CONSUMABLE PURCHASE IS STOCK, NOT CASH. Nothing here posts to
--      cash_entry. The money side of buying packaging is an expense (0051) or a
--      purchase invoice (0037); posting it here as well would double-count the
--      spend. `unit_cost` on a purchase movement exists for the Purchase and
--      Consumption reports, and for nothing else. This is the same firewall
--      0051's note 5 draws around the supplier link.
--   5. CATEGORIES AND UNITS COME FROM store_lists. A new `consumable_category`
--      kind; units reuse the existing `unit` list, which already holds kg, litre
--      and pcs — the very examples §3.2 gives.
--   6. ALERTS ARE DERIVED, NEVER STORED. §3.4 calls them system-generated, so
--      `consumable_alert_v` computes them on read. Nothing inserts an alert, so
--      nothing can leave a stale one behind. The one alert §3.4 wants *blocked*
--      rather than flagged — a movement that would push stock negative — is a
--      hard error in 0063 instead.
-- ============================================================================

-- ─── store_lists: the consumable category list (note 5) ─────────────────────
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.store_lists'::regclass
    and conname = 'store_lists_kind_check';

  if v_def is null or v_def not like '%consumable_category%' then
    alter table public.store_lists drop constraint if exists store_lists_kind_check;
    alter table public.store_lists add constraint store_lists_kind_check
      check (kind in ('category','emoji','unit','reason',
                      'asset_category','consumable_category'));
  end if;
end $ck$;

insert into public.store_lists (kind, value, sort_order) values
  ('consumable_category','Packaging',0),
  ('consumable_category','Raw materials',1),
  ('consumable_category','Cleaning supplies',2),
  ('consumable_category','Office supplies',3),
  ('consumable_category','Disposables',4),
  ('consumable_category','Others',5)
on conflict (kind, value) do nothing;

-- ─── The item master ────────────────────────────────────────────────────────
create sequence if not exists consumable_code_seq start 1;

create table if not exists public.consumable (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique
                  default 'CON-' || lpad(nextval('consumable_code_seq')::text, 4, '0'),

  name          text not null check (btrim(name) <> ''),
  category      text not null check (btrim(category) <> ''),
  unit          text not null check (btrim(unit) <> ''),
  vendor_id     uuid references public.suppliers(id),

  -- Note 1: no current_stock column, on purpose.
  min_stock     numeric(12,3) not null default 0 check (min_stock >= 0),
  max_stock     numeric(12,3) check (max_stock is null or max_stock >= 0),
  reorder_level numeric(12,3) check (reorder_level is null or reorder_level >= 0),
  -- §3.5's "configurable reorder quantity". Null falls back to topping up to
  -- max_stock, then to min_stock.
  reorder_qty   numeric(12,3) check (reorder_qty is null or reorder_qty > 0),

  cost_per_unit numeric(12,2) check (cost_per_unit is null or cost_per_unit >= 0),

  -- §3.2: perishables only.
  expiry_date   date,
  storage_location text not null default '',
  notes         text not null default '',

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id) on delete set null,

  -- A ceiling below the floor would make every purchase recommendation negative.
  constraint consumable_max_above_min
    check (max_stock is null or max_stock >= min_stock),
  -- §3.2 allows the reorder level to differ from the minimum, but not to sit
  -- above the ceiling — that would order stock there is nowhere to put.
  constraint consumable_reorder_within_max
    check (reorder_level is null or max_stock is null or reorder_level <= max_stock)
);

-- "Sugar (kg)" and "Sugar (bag)" are different items; two live "Sugar (kg)" are
-- the same one entered twice. A partial index, not a constraint, so a removed
-- item does not block re-adding it.
create unique index if not exists consumable_name_unit_uniq
  on public.consumable (name, unit) where deleted_at is null;

create index if not exists consumable_category_idx
  on public.consumable (category) where deleted_at is null;
create index if not exists consumable_name_idx
  on public.consumable (lower(name)) where deleted_at is null;
create index if not exists consumable_vendor_idx
  on public.consumable (vendor_id) where vendor_id is not null;
create index if not exists consumable_expiry_idx
  on public.consumable (expiry_date) where deleted_at is null and expiry_date is not null;

drop trigger if exists consumable_touch on public.consumable;
create trigger consumable_touch before update on public.consumable
  for each row execute function public.set_updated_at();

-- ─── The ledger (§3.3) ──────────────────────────────────────────────────────
create table if not exists public.stock_movement (
  id            uuid primary key default gen_random_uuid(),
  consumable_id uuid not null references public.consumable(id),

  movement_type text not null
                  check (movement_type in ('purchase','issue','return',
                                           'adjustment','wastage','expired','damaged')),

  -- Note 3: positive except on an adjustment.
  qty           numeric(12,3) not null,
  qty_signed    numeric(12,3) generated always as (
                  case movement_type
                    when 'purchase'   then abs(qty)
                    when 'return'     then abs(qty)
                    when 'adjustment' then qty
                    else -abs(qty)
                  end
                ) stored,

  on_date       date not null,
  -- Note 4: for the reports, never for the cash book.
  unit_cost     numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  vendor_id     uuid references public.suppliers(id),
  -- Who the stock was issued to, when that is worth recording.
  issued_to     uuid references public.profiles(id) on delete set null,

  reason        text not null default '',
  remarks       text not null default '',

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint stock_movement_qty_sign
    check (case when movement_type = 'adjustment' then qty <> 0 else qty > 0 end),
  -- §3.3: "Reason (required for Adjustment/Wastage/Expired/Damaged)".
  constraint stock_movement_reason_required
    check (movement_type not in ('adjustment','wastage','expired','damaged')
           or btrim(reason) <> ''),
  constraint stock_movement_cost_on_purchase
    check (unit_cost is null or movement_type = 'purchase')
);

create index if not exists stock_movement_item_idx
  on public.stock_movement (consumable_id, on_date desc, created_at desc);
create index if not exists stock_movement_type_idx
  on public.stock_movement (movement_type, on_date desc);
create index if not exists stock_movement_date_idx
  on public.stock_movement (on_date desc);

-- Note 2: append-only, the same guard cash_entry carries (0045).
create or replace function public.stock_movement_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a stock movement is never deleted — record an adjustment instead';
  end if;
  raise exception 'a stock movement is never edited — record an adjustment instead';
end $$;

drop trigger if exists stock_movement_no_delete on public.stock_movement;
create trigger stock_movement_no_delete before delete on public.stock_movement
  for each row execute function public.stock_movement_immutable();

drop trigger if exists stock_movement_no_update on public.stock_movement;
create trigger stock_movement_no_update before update on public.stock_movement
  for each row execute function public.stock_movement_immutable();

-- ─── RLS: read with consumables.view; writes only via the 0063 RPCs ─────────
alter table public.consumable enable row level security;
drop policy if exists consumable_read on public.consumable;
create policy consumable_read on public.consumable for select
  using (public.has_perm('consumables.view'));

alter table public.stock_movement enable row level security;
drop policy if exists stock_movement_read on public.stock_movement;
create policy stock_movement_read on public.stock_movement for select
  using (public.has_perm('consumables.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
-- `current_stock` is the ledger sum (note 1) and every derived figure below is
-- computed from it, so the list, the alerts and the recommendation can never
-- disagree with each other.
create or replace view public.consumable_v as
select
  c.id, c.code, c.name, c.category, c.unit,
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

create or replace view public.stock_movement_v as
select
  m.id, m.consumable_id,
  c.code as item_code, c.name as item_name, c.category as item_category,
  c.unit,
  m.movement_type, m.qty, m.qty_signed,
  m.on_date, m.unit_cost,
  round(coalesce(m.unit_cost, 0) * abs(m.qty), 2) as movement_value,
  m.vendor_id,
  coalesce(v.name, '') as vendor_name,
  m.issued_to,
  coalesce(it.name, '') as issued_to_name,
  m.reason, m.remarks,
  m.created_by,
  coalesce(cb.name, '') as created_by_name,
  m.created_at
from public.stock_movement m
join public.consumable c on c.id = m.consumable_id
left join public.suppliers v on v.id = m.vendor_id
left join public.profiles it on it.id = m.issued_to
left join public.profiles cb on cb.id = m.created_by
where c.deleted_at is null
  and public.has_perm('consumables.view');

-- ─── Alerts (§3.4) ──────────────────────────────────────────────────────────
-- One row per live alert, derived on read (note 6). `severity` orders the panel:
-- 2 is act-now, 1 is act-soon.
--
-- The consumption alert compares the last 30 days of *outward* movement against
-- the same figure averaged over the three 30-day windows before it. It needs a
-- real baseline — some outward movement in that earlier span — so a brand-new
-- item's first busy month does not read as an anomaly.
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
grant select on public.stock_movement_v to authenticated;
grant select on public.consumable_alert_v to authenticated;

-- ─── store_lists: teach the two writers about the new kinds ─────────────────
-- Reproduced from 0006 with the two kinds added and the in-use guard widened —
-- removing a category or unit something still references would orphan it.
create or replace function public.add_list_value(p_kind text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := trim(p_value); v_next int;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_kind not in ('category','emoji','unit','reason',
                    'asset_category','consumable_category') then
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
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select * into r from public.store_lists where id = p_id;
  if not found then raise exception 'not found'; end if;
  if r.kind = 'category' then
    select count(*) into n from public.items where category = r.value;
    if n > 0 then raise exception 'in use by % item(s)', n; end if;
  elsif r.kind = 'unit' then
    select count(*) into n from public.items where unit = r.value;
    if n > 0 then raise exception 'in use by % item(s)', n; end if;
    select count(*) into n from public.consumable
      where unit = r.value and deleted_at is null;
    if n > 0 then raise exception 'in use by % consumable(s)', n; end if;
  elsif r.kind = 'asset_category' then
    select count(*) into n from public.asset
      where category = r.value and deleted_at is null;
    if n > 0 then raise exception 'in use by % asset(s)', n; end if;
  elsif r.kind = 'consumable_category' then
    select count(*) into n from public.consumable
      where category = r.value and deleted_at is null;
    if n > 0 then raise exception 'in use by % consumable(s)', n; end if;
  end if;
  delete from public.store_lists where id = p_id;
end $$;

grant execute on function
  public.add_list_value(text, text), public.delete_list_value(uuid)
to authenticated;
