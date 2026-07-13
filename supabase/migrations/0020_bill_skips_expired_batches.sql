-- ============================================================================
-- BT Store Management — billing skips expired batches
-- Selling never draws from an expired batch: bill generation consumes from the
-- earliest NON-expired batch (still FIFO within fresh stock). The bill page also
-- needs per-batch data to hide products with no fresh stock and to show the
-- earliest fresh batch, so items_v now exposes each item's in-stock batches.
-- "Expired" is a calendar-day comparison in the client's timezone (p_tz), the
-- same convention dashboard_stats (0004) uses.
-- ============================================================================

-- ─── items_v: expose in-stock batches (qty + expiry) ─────────────────────────
-- Appended after earliest_expiry: CREATE OR REPLACE VIEW can only add columns
-- at the end. Batches are ordered soonest-expiry-first (NULLs last), matching
-- FIFO. The client filters expired batches locally via expiryStatus().
create or replace view public.items_v as
  select
    id, name, emoji, category, unit, price,
    case when public.has_perm('inventory') or public.has_perm('analytics')
         then cost_price else null end as cost_price,
    qty, created_at, updated_at,
    tracks_expiry,
    (select min(sb.expiry_date) from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as earliest_expiry,
    (select coalesce(
              jsonb_agg(
                jsonb_build_object('qty', sb.qty, 'expiryDate', sb.expiry_date)
                order by sb.expiry_date asc nulls last, sb.created_at asc),
              '[]'::jsonb)
       from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as batches
  from public.items;

-- ─── consume_fresh_fifo: FIFO across NON-expired batches only ────────────────
-- Like consume_fifo, but never touches a batch whose expiry_date is before
-- today (in p_tz). Overdraw beyond fresh stock is clamped (no error), so a sale
-- can never silently deduct expired stock. Used by generate_bill; stock_out
-- keeps the original consume_fifo (manual removal may target expired stock).
create or replace function public.consume_fresh_fifo(p_item uuid, p_qty numeric, p_tz text)
returns void language plpgsql set search_path = public as $$
declare b public.stock_batches; remaining numeric := p_qty; take numeric;
        v_today date := (now() at time zone coalesce(p_tz, 'UTC'))::date;
begin
  for b in
    select * from public.stock_batches
    where item_id = p_item and qty > 0
      and (expiry_date is null or expiry_date >= v_today)
    order by expiry_date asc nulls last, created_at asc
    for update
  loop
    exit when remaining <= 0;
    take := least(b.qty, remaining);
    update public.stock_batches set qty = qty - take where id = b.id;
    remaining := remaining - take;
  end loop;
  delete from public.stock_batches where item_id = p_item and qty <= 0;
  update public.items set qty =
    coalesce((select sum(qty) from public.stock_batches where item_id = p_item), 0)
    where id = p_item;
end $$;
revoke execute on function public.consume_fresh_fifo(uuid, numeric, text) from public;

-- ─── generate_bill: take p_tz, consume fresh batches only ────────────────────
-- Body reproduced from 0017 with two changes: the new p_tz parameter and
-- consume_fresh_fifo in place of consume_fifo. Old 2-arg signature is dropped
-- so the RPC resolves unambiguously to this one.
drop function if exists public.generate_bill(jsonb, jsonb);
create or replace function public.generate_bill(customer jsonb, lines jsonb, p_tz text default 'UTC')
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_disc numeric; v_taxable numeric; v_customer uuid;
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
    perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;
grant execute on function public.generate_bill(jsonb, jsonb, text) to authenticated;
