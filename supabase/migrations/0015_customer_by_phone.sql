-- ============================================================================
-- BT Store Management — indexed single-customer lookup
-- Checkout's phone-autofill previously called customers_with_stats(), which
-- left-joins EVERY bill against EVERY customer and groups the whole table just
-- to filter one row client-side — on every completed 10-digit phone entry.
-- This filters on the indexed customers.phone first, so only the matched
-- customer's own bills are aggregated.
-- ============================================================================

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
    and (public.has_perm('sales') or public.has_perm('inventory'))
  group by c.id
$$;

grant execute on function public.customer_by_phone(text) to authenticated;
