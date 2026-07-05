-- ============================================================================
-- BT Store Management — bill payment method (Cash / UPI)
-- Adds how a bill was paid, printed on the receipt as "Paid via: <method>".
-- ============================================================================

alter table public.bills
  add column if not exists payment_method text not null default 'Cash'
    check (payment_method in ('Cash','UPI'));

-- Re-create generate_bill to persist the payment method. The signature is
-- unchanged (method rides in the `customer` jsonb), so `create or replace`
-- needs no re-grant.
create or replace function public.generate_bill(customer jsonb, lines jsonb)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;

  v_tax := v_sub * v_rate / 100;
  insert into public.bills (customer_name, customer_phone, subtotal, tax, total, tax_rate, payment_method, created_by)
    values (coalesce(customer->>'name',''), coalesce(customer->>'phone',''),
            v_sub, v_tax, v_sub + v_tax, v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price);
    update public.items set qty = greatest(0, qty - v_qty) where id = it.id;
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;
