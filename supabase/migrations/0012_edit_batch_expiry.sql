-- ============================================================================
-- BT Store Management — allow editing a batch's expiry date
-- Correcting a mistyped best-before date. Quantity is untouched, so items.qty
-- (the SUM-of-batches mirror) does not change. earliest_expiry on items_v is
-- computed live, so it reflects the new date on next read.
-- ============================================================================
create or replace function public.update_batch_expiry(p_batch_id uuid, p_expiry date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  if p_expiry is null then raise exception 'expiry date required'; end if;
  update public.stock_batches set expiry_date = p_expiry where id = p_batch_id;
  if not found then raise exception 'batch not found'; end if;
end $$;

grant execute on function public.update_batch_expiry(uuid, date) to authenticated;
