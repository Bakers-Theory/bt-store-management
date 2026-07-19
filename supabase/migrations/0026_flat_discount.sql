-- ============================================================================
-- BT Store Management — flat-amount discounts
-- Bills could only carry a percentage discount. Add an optional flat (₹-off)
-- mode: a bill now records its discount_type ('percent' | 'flat') and the actual
-- money discounted (discount_amount), alongside the existing discount_percent.
-- ============================================================================

alter table public.bills
  add column if not exists discount_type text not null default 'percent'
    check (discount_type in ('percent', 'flat')),
  add column if not exists discount_amount numeric(12,2) not null default 0;

-- Backfill the money discounted for existing percentage bills so historical
-- receipts keep showing the amount that was taken off.
update public.bills
  set discount_amount = round(subtotal * discount_percent / 100, 2)
  where discount_amount = 0 and discount_percent > 0;

-- ─── bills_v: recreate so the new columns surface (b.* is frozen at create) ───
drop view if exists public.bills_v;
create view public.bills_v as
  select b.*, p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('sales') or public.has_perm('inventory');
grant select on public.bills_v to authenticated;

-- ─── generate_bill: accept a percent OR flat discount ────────────────────────
-- Reproduced from 0022; only the discount math and the bills INSERT change.
drop function if exists public.generate_bill(jsonb, jsonb, text);
create or replace function public.generate_bill(customer jsonb, lines jsonb, p_tz text default 'UTC')
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_type text; v_disc numeric := 0; v_amt numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  if not (select is_open from public.store_settings where id = 1) then
    raise exception 'Store is closed — new bills cannot be created';
  end if;

  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;
  v_sub := round(v_sub, 2);

  if v_phone <> '' then
    insert into public.customers (phone, name)
      values (v_phone, coalesce(customer->>'name',''))
      on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name
                        else public.customers.name end,
            last_seen = now()
      returning id into v_customer;
  end if;

  -- Flat clamps the ₹-off to the subtotal; percent clamps the rate to 0–100.
  v_type := case when customer->>'discountType' = 'flat' then 'flat' else 'percent' end;
  if v_type = 'flat' then
    v_amt := least(v_sub, greatest(0, round(coalesce((customer->>'discount')::numeric, 0), 2)));
  else
    v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
    v_amt := round(v_sub * v_disc / 100, 2);
  end if;
  v_taxable := round(v_sub - v_amt, 2);
  v_tax := round(v_taxable * v_rate / 100, 2);
  insert into public.bills (customer_name, customer_phone, customer_id,
                            subtotal, tax, total, tax_rate, payment_method,
                            discount_percent, discount_type, discount_amount, created_by)
    values (coalesce(customer->>'name',''), v_phone, v_customer,
            v_sub, v_tax, round(v_taxable + v_tax, 2), v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            v_disc, v_type, v_amt, auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price, image_url)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price, it.image_url);
    perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;
grant execute on function public.generate_bill(jsonb, jsonb, text) to authenticated;
