-- ============================================================================
-- BT Store Management — round currency to the cent
-- generate_bill computed subtotal/tax/total as raw `numeric` with no rounding,
-- so a fractional tax_rate/discount left many fractional-paisa digits stored
-- (and later summed by dashboard_stats / the Excel export), silently drifting
-- from the 2dp total shown on the receipt. Round at each step and constrain
-- the columns so bad data can't re-enter through a future RPC either.
-- ============================================================================

-- bills_v (0013) is `select b.*`, so it depends on these three columns and
-- Postgres refuses to retype them underneath it. Drop it, retype, recreate it
-- verbatim from 0013 — the same dance 0026/0028/0055 do for this view.
drop view if exists public.bills_v;

alter table public.bills
  alter column subtotal type numeric(12,2),
  alter column tax      type numeric(12,2),
  alter column total    type numeric(12,2);

create view public.bills_v as
  select
    b.*,
    p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('sales') or public.has_perm('inventory');

grant select on public.bills_v to authenticated;

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

  v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
  v_taxable := round(v_sub - (v_sub * v_disc / 100), 2);
  v_tax := round(v_taxable * v_rate / 100, 2);
  insert into public.bills (customer_name, customer_phone, customer_id,
                            subtotal, tax, total, tax_rate, payment_method,
                            discount_percent, created_by)
    values (coalesce(customer->>'name',''), v_phone, v_customer,
            v_sub, v_tax, round(v_taxable + v_tax, 2), v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            v_disc, auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price);
    perform public.consume_fifo(it.id, v_qty);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;
