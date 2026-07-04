-- ============================================================================
-- 0005 — Expose the bill_items primary key from bill_lines_with_cost().
-- The Excel export needs the real cost recorded at sale time (bill_items.
-- cost_price) so its COGS / profit / margin match the dashboard, which reads
-- the same column server-side. cost_price is revoked from the client role, so
-- the export reads it through this analytics-gated SECURITY DEFINER function
-- and joins it back onto each fetched line by id.
--
-- Adding a return column requires dropping and recreating the function.
-- ============================================================================

drop function if exists public.bill_lines_with_cost();

create or replace function public.bill_lines_with_cost()
returns table (id uuid, bill_id uuid, item_id uuid, category text, qty numeric,
               price numeric, cost_price numeric, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select bi.id, bi.bill_id, bi.item_id, i.category, bi.qty, bi.price, bi.cost_price,
         b.status, b.created_at
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  left join public.items i on i.id = bi.item_id
  where public.has_perm('analytics')
$$;

grant execute on function public.bill_lines_with_cost() to authenticated;
