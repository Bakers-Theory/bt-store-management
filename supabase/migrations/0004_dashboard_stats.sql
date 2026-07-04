-- ============================================================================
-- 0004 — Server-side dashboard aggregation.
-- The client used to download every bill / bill_item / activity_log row and
-- recompute analytics in the browser. This RPC collapses all of that into a
-- single bounded JSON payload so the dashboard scales regardless of history
-- size. All date bucketing is done in the client's local timezone (p_tz, an
-- IANA name) so KPIs / weekly / day-of-week / hour match the previous
-- browser-local behaviour.
--
-- Permission model (matches the existing policies):
--   * needs 'sales' | 'inventory' | 'analytics' to run at all;
--   * cost of goods (cogs) is returned only to 'analytics' users (column
--     privacy from 0002);
--   * individual bills (recentBills) are returned only to 'sales' | 'inventory'
--     users, mirroring the bills_read RLS policy.
-- ============================================================================

create or replace function public.dashboard_stats(p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_can_bills boolean := public.has_perm('sales') or public.has_perm('inventory');
  v_can_cost  boolean := public.has_perm('analytics');
  v_today     date := (now() at time zone p_tz)::date;
begin
  if not (v_can_bills or v_can_cost) then
    raise exception 'forbidden';
  end if;

  return (
    with
    -- Active bills with their local (client-tz) calendar date + timestamp.
    active as (
      select
        b.id, b.total, b.created_at,
        (b.created_at at time zone p_tz) as local_ts,
        (b.created_at at time zone p_tz)::date as local_date
      from public.bills b
      where b.status = 'active'
    ),
    -- Active bill lines joined to their (possibly-deleted) item for category/cost.
    active_lines as (
      select
        bi.item_id, bi.name, bi.qty, bi.price, bi.cost_price,
        coalesce(i.category, 'General') as category,
        a.local_date
      from public.bill_items bi
      join active a on a.id = bi.bill_id
      left join public.items i on i.id = bi.item_id
    )
    select jsonb_build_object(

      'today', v_today::text,

      'kpis', jsonb_build_object(
        'todaySales',     (select coalesce(sum(total), 0) from active where local_date =  v_today),
        'yesterdaySales', (select coalesce(sum(total), 0) from active where local_date = (v_today - 1)),
        'billsToday',     (select count(*)                from active where local_date =  v_today),
        'itemsSoldToday', (select coalesce(sum(qty), 0)   from active_lines where local_date = v_today)
      ),

      -- Per-day totals for the last 7 local days (client fills empty buckets).
      'weekly', coalesce((
        select jsonb_agg(jsonb_build_object('date', d::text, 'total', t) order by d)
        from (
          select local_date as d, sum(total) as t
          from active
          where local_date > (v_today - 7) and local_date <= v_today
          group by local_date
        ) w
      ), '[]'::jsonb),

      -- Top 5 items by units sold (grouped by name; item names are unique).
      'topItems', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'qty', qty) order by qty desc)
        from (
          select name, sum(qty) as qty
          from active_lines
          group by name
          order by sum(qty) desc
          limit 5
        ) t
      ), '[]'::jsonb),

      -- Revenue (and cogs, analytics-only) per category.
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'category', category,
          'revenue', revenue,
          'cogs', case when v_can_cost then cogs else null end
        ) order by revenue desc)
        from (
          select category, sum(qty * price) as revenue, sum(qty * cost_price) as cogs
          from active_lines
          group by category
        ) c
      ), '[]'::jsonb),

      -- Units sold per (still-existing) item, for stock-health days-of-cover.
      'soldByItem', coalesce((
        select jsonb_agg(jsonb_build_object('itemId', item_id, 'qty', qty))
        from (
          select item_id, sum(qty) as qty
          from active_lines
          where item_id is not null
          group by item_id
        ) s
      ), '[]'::jsonb),

      -- Span (in days) between first and last active bill; matches the browser's
      -- Math.round(msDiff / 86400000) + 1, floored at 1.
      'daySpan', (
        select case
          when count(*) = 0 then 1
          else greatest(1, round(extract(epoch from (max(created_at) - min(created_at))) / 86400)::int + 1)
        end
        from active
      ),

      -- Revenue by local day-of-week (0=Sun..6=Sat) for the "best day" insight.
      'dowRevenue', coalesce((
        select jsonb_agg(jsonb_build_object('dow', dow, 'total', total))
        from (
          select extract(dow from local_ts)::int as dow, sum(total) as total
          from active
          group by extract(dow from local_ts)::int
        ) d
      ), '[]'::jsonb),

      -- Bill count by local hour (0..23) for the "busiest hour" insight.
      'hourCounts', coalesce((
        select jsonb_agg(jsonb_build_object('hour', hour, 'count', cnt))
        from (
          select extract(hour from local_ts)::int as hour, count(*) as cnt
          from active
          group by extract(hour from local_ts)::int
        ) h
      ), '[]'::jsonb),

      -- Single highest-revenue item by name.
      'topEarner', (
        select jsonb_build_object('name', name, 'revenue', revenue)
        from (
          select name, sum(qty * price) as revenue
          from active_lines
          group by name
          order by sum(qty * price) desc
          limit 1
        ) e
      ),

      -- Newest 5 bills (any status) — only for users who can read bills.
      'recentBills', case when not v_can_bills then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'billNo', bill_no, 'customerName', customer_name,
          'total', total, 'status', status, 'date', created_at
        ) order by created_at desc)
        from (
          select id, bill_no, customer_name, total, status, created_at
          from public.bills
          order by created_at desc
          limit 5
        ) r
      ), '[]'::jsonb) end

    )
  );
end $$;

grant execute on function public.dashboard_stats(text) to authenticated;
