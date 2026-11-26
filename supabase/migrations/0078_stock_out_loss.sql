-- ============================================================================
-- BT Store Management — "Declare as loss" on Stock Out (#111)
--
-- A stock-out could not say whether the removed stock is a business loss
-- (expired, wasted) or not (sampling, giveaway). Now:
--
--   1. activity_log.is_loss flags the `out` row; `total` holds its value,
--      qty × cost_price (selling price when no cost is set), so the history
--      shows "₹120 loss" without recomputing against today's price.
--   2. That value is cost-derived, so activity_log_v hides `total` on `out`
--      rows from anyone who may not see cost — the rule items_v follows.
--   3. inventory_loss(from, to) sums declared losses for the P&L, gated by
--      dashboard.profit exactly like cashbook_cogs.
-- ============================================================================

alter table public.activity_log add column if not exists is_loss boolean not null default false;

-- ─── activity_log_v ─────────────────────────────────────────────────────────
-- Reproduced from 0028; `total` is masked on `out` rows and is_loss is ADDED.
create or replace view public.activity_log_v as
  select
    l.id, l.type, l.created_at,
    l.item_id, l.item_name, l.qty, l.supplier, l.reason, l.notes,
    l.bill_no, l.items,
    case when l.type = 'out'
          and not (public.has_perm('items.cost') or public.has_perm('dashboard.profit'))
         then null else l.total end as total,
    p.name as actor_name,
    l.is_loss
  from public.activity_log l
  left join public.profiles p on p.id = l.actor
  where public.has_perm('activity.view');

-- ─── stock_out: one new argument ────────────────────────────────────────────
-- Dropped first so the old 4-arg overload cannot shadow the new one.
drop function if exists public.stock_out(uuid, numeric, text, text);
create or replace function public.stock_out(
  p_item uuid, p_qty numeric, p_reason text, p_notes text, p_is_loss boolean default false
)
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
  insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes, is_loss, total)
    values ('out', auth.uid(), p_item, v.name, p_qty, p_reason, p_notes, coalesce(p_is_loss, false),
            case when p_is_loss
                 then round(p_qty * coalesce(nullif(v.cost_price, 0), v.price), 2) end);
  select * into v_row from public.items_v where id = p_item;
  return v_row;
end $$;
grant execute on function public.stock_out(uuid, numeric, text, text, boolean) to authenticated;

-- ─── inventory_loss: declared losses in a date range ────────────────────────
create or replace function public.inventory_loss(p_from date, p_to date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_loss numeric;
begin
  -- Absent, not zero (same contract as cashbook_cogs).
  if not public.has_perm('dashboard.profit') then return null; end if;

  select timezone into v_tz from public.store_settings where id = 1;

  select coalesce(round(sum(l.total), 2), 0)
    into v_loss
  from public.activity_log l
  where l.type = 'out' and l.is_loss
    and (p_from is null or (l.created_at at time zone v_tz)::date >= p_from)
    and (p_to   is null or (l.created_at at time zone v_tz)::date <= p_to);

  return v_loss;
end $$;
grant execute on function public.inventory_loss(date, date) to authenticated;
