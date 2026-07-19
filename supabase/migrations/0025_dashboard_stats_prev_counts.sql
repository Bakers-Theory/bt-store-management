-- ============================================================================
-- 0025 — Add previous-period bill & item counts to dashboard_stats.
-- 0021 returned only prevSales for the delta badge; this adds prevBills and
-- prevItemsSold so the Bills and Items-Sold KPI tiles can show their own
-- trend vs. the preceding equal-length window. Everything else is unchanged
-- from 0021 (same signature, permission / tz / cogs-privacy model).
-- ============================================================================

create or replace function public.dashboard_stats(
  p_tz text default 'UTC',
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_can_bills boolean := public.has_perm('sales') or public.has_perm('inventory');
  v_can_cost  boolean := public.has_perm('analytics');
  v_today     date := (now() at time zone p_tz)::date;
  v_bounded   boolean := p_from is not null and p_to is not null;
  v_span      int  := case when v_bounded then greatest(1, (p_to - p_from) + 1) end;
  v_prev_from date := case when v_bounded then p_from - v_span end;
  v_prev_to   date := case when v_bounded then p_from - 1 end;
begin
  if not (v_can_bills or v_can_cost) then
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
