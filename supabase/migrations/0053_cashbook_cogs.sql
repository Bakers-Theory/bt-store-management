-- ============================================================================
-- BT Store Management — cost of goods sold for a date range (Phase D)
--
--   1. WHY AN RPC AND NOT A VIEW. bill_items.cost_price is REVOKED at the column
--      level from `authenticated` (0002). Only a SECURITY DEFINER function can
--      read it, and only one that re-checks dashboard.profit should.
--   2. NULL, NOT ZERO, WITHOUT THE KEY. dashboard_stats already returns
--      `cogs: null` for a caller without dashboard.profit (0004, 0021). Zero
--      would render as "we made 100% margin", which is worse than a blank.
--   3. CANCELLED BILLS ARE EXCLUDED. They sold nothing, so they consumed no
--      cost. This mirrors excel.ts, where cancelled bills are out of every
--      aggregate.
--   4. THE RANGE IS IN THE STORE'S CALENDAR. bills has no date column, so
--      created_at is converted through store_settings.timezone — the same
--      conversion the 0046 backfill used for on_date, so a bill's COGS and its
--      ledger row always fall on the same day.
-- ============================================================================

create or replace function public.cashbook_cogs(p_from date, p_to date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_cogs numeric;
begin
  -- Note 2: absent, not zero.
  if not public.has_perm('dashboard.profit') then return null; end if;

  select timezone into v_tz from public.store_settings where id = 1;

  select coalesce(round(sum(bi.qty * coalesce(bi.cost_price, 0)), 2), 0)
    into v_cogs
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  where b.status = 'active'
    and (p_from is null or (b.created_at at time zone v_tz)::date >= p_from)
    and (p_to   is null or (b.created_at at time zone v_tz)::date <= p_to);

  return v_cogs;
end $$;

grant execute on function public.cashbook_cogs(date, date) to authenticated;
