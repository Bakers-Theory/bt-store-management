-- ============================================================================
-- BT Store Management — edit a customer's name / phone
-- The customer directory was read-only, so a name/phone mistyped at billing
-- time was permanent. Add an RPC to correct it. Writes stay RPC-only (the
-- customers table has no client-write policy). Gated on 'sales' — the same
-- permission that reaches the customers page and creates the typo at billing.
-- ============================================================================

create or replace function public.update_customer(p_id uuid, p_name text, p_phone text)
returns public.customers language plpgsql security definer set search_path = public as $$
declare v_row public.customers;
        v_phone text := nullif(btrim(p_phone), '');
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  if v_phone is null then raise exception 'Phone number is required'; end if;

  update public.customers
    set name = coalesce(p_name, ''), phone = v_phone
    where id = p_id
    returning * into v_row;
  if not found then raise exception 'Customer not found'; end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'Another customer already uses that phone number';
end $$;

grant execute on function public.update_customer(uuid, text, text) to authenticated;
