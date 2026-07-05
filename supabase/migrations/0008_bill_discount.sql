-- ============================================================================
-- BT Store Management — bill discount (percentage)
-- An optional % discount entered at billing time, applied to the subtotal
-- before tax. Printed on the receipt only when > 0.
-- ============================================================================

alter table public.bills
  add column if not exists discount_percent numeric not null default 0
    check (discount_percent >= 0 and discount_percent <= 100);

-- Re-create generate_bill to apply the discount (rides in the `customer` jsonb,
-- so the signature is unchanged and no re-grant is needed). subtotal is stored
-- gross; tax is charged on the discounted amount; total = discounted + tax.
create or replace function public.generate_bill(customer jsonb, lines jsonb)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_disc numeric; v_taxable numeric;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;

  v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
  v_taxable := v_sub - (v_sub * v_disc / 100);
  v_tax := v_taxable * v_rate / 100;
  insert into public.bills (customer_name, customer_phone, subtotal, tax, total, tax_rate, payment_method, discount_percent, created_by)
    values (coalesce(customer->>'name',''), coalesce(customer->>'phone',''),
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
