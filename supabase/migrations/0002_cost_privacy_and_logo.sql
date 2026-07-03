-- ============================================================================
-- 0002 — Enforce cost privacy via a definer view + column-level grants, and
-- add the logo RPC. (The column REVOKE in 0001 is a no-op against the default
-- table-level SELECT grant, so cost was still readable; this fixes it.)
-- ============================================================================

-- Items: remove table-level SELECT, grant every column EXCEPT cost_price.
revoke select on public.items from anon, authenticated;
grant select
  (id, name, name_key, emoji, category, unit, price, qty, created_at, updated_at)
  on public.items to authenticated;

-- Bill items: same — hide cost_price from direct reads.
revoke select on public.bill_items from anon, authenticated;
grant select
  (id, bill_id, item_id, name, emoji, unit, qty, price)
  on public.bill_items to authenticated;

-- Read items through this view. It is SECURITY DEFINER (default), so it can read
-- cost_price, but only *returns* it to users with inventory/analytics permission.
create or replace view public.items_v as
  select
    id, name, emoji, category, unit, price,
    case when public.has_perm('inventory') or public.has_perm('analytics')
         then cost_price else null end as cost_price,
    qty, created_at, updated_at
  from public.items;

grant select on public.items_v to authenticated;

-- Logo (base64 data URL stored directly in logo_url; owner only).
create or replace function public.update_logo(p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  update public.store_settings set logo_url = p_url where id = 1;
end $$;

grant execute on function public.update_logo(text) to authenticated;
