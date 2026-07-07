-- ============================================================================
-- BT Store Management — make the customer phone optional on billing
-- Many customers won't share a number. A phone-less bill is an anonymous
-- walk-in: no customer row is created (phone is the customer identity), so
-- customer_id stays NULL and the bill never joins the customer directory.
-- Bills WITH a phone are unchanged — customer is still upserted & linked.
-- Based verbatim on the 0009 version; only the phone guard and the
-- conditional customer upsert differ. Signature unchanged → no re-grant needed.
-- ============================================================================
create or replace function public.generate_bill(customer jsonb, lines jsonb)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_disc numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;

  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;

  -- Upsert the customer only when a phone was given (phone is the identity).
  -- No phone → anonymous walk-in, v_customer stays NULL.
  if v_phone <> '' then
    insert into public.customers (phone, name)
      values (v_phone, coalesce(customer->>'name',''))
      on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name
                        else public.customers.name end,
            last_seen = now()
      returning id into v_customer;
  end if;

  v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
  v_taxable := v_sub - (v_sub * v_disc / 100);
  v_tax := v_taxable * v_rate / 100;
  insert into public.bills (customer_name, customer_phone, customer_id,
                            subtotal, tax, total, tax_rate, payment_method,
                            discount_percent, created_by)
    values (coalesce(customer->>'name',''), v_phone, v_customer,
            v_sub, v_tax, v_taxable + v_tax, v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            v_disc, auth.uid())
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
