-- ============================================================================
-- BT Store Management — set a single item's image
-- Lets the item modal persist an uploaded/removed product image immediately,
-- without going through update_item (which would also write name/price/etc.
-- that the user may still be editing). Returns the refreshed items_v row so the
-- client can patch its cache in place.
-- ============================================================================

create or replace function public.set_item_image(p_id uuid, p_url text)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  update public.items set image_url = nullif(p_url, '') where id = p_id;
  if not found then raise exception 'item not found'; end if;
  select * into v_row from public.items_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.set_item_image(uuid, text) to authenticated;
