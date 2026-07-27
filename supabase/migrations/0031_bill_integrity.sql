-- ============================================================================
-- Checkout correctness: refuse to oversell, survive a retried checkout, and
-- build the receipt from what was actually stored.
-- ============================================================================

-- Stable receipt ordering. Rows written before this migration have no line
-- number and fall back to name ordering, which is what they effectively had.
alter table public.bill_items add column if not exists line_no int;

-- Idempotency key for a checkout attempt. Nullable so the column can be added
-- to existing bills; the partial unique index only constrains real refs.
alter table public.bills add column if not exists client_ref uuid;
create unique index if not exists bills_client_ref_key
  on public.bills (client_ref) where client_ref is not null;

-- ─── consume_fresh_fifo: refuse to oversell ─────────────────────────────────
-- Reproduced from 0020; the shortfall check is the only change. Previously the
-- loop simply ran out of batches and returned, so a bill for more stock than
-- existed committed happily: quantities floored at zero and nothing anywhere
-- recorded that we had sold what we did not have. Two tablets at the counter
-- could each sell the last of an item. Raising here aborts the surrounding
-- generate_bill transaction, which is the only correct outcome.
create or replace function public.consume_fresh_fifo(p_item uuid, p_qty numeric, p_tz text)
returns void language plpgsql set search_path = public as $$
declare b public.stock_batches; remaining numeric := p_qty; take numeric;
        v_today date := (now() at time zone coalesce(p_tz, 'UTC'))::date;
        v_name text;
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

  if remaining > 0 then
    select name into v_name from public.items where id = p_item;
    raise exception 'Not enough stock for %: % left, % requested',
      coalesce(v_name, 'item'), p_qty - remaining, p_qty;
  end if;

  delete from public.stock_batches where item_id = p_item and qty <= 0;
  update public.items set qty =
    coalesce((select sum(qty) from public.stock_batches where item_id = p_item), 0)
    where id = p_item;
end $$;
revoke execute on function public.consume_fresh_fifo(uuid, numeric, text) from public;

-- ─── bill_payload: the one shape generate_bill returns ──────────────────────
-- Bill row plus its stored lines, so the client never has to reconstruct a
-- receipt from its own cart. cost_price is listed out rather than dumped with
-- to_jsonb because it is private and must not reach the browser.
create or replace function public.bill_payload(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bill', to_jsonb(b) - 'client_ref' || jsonb_build_object('biller_name', p.name),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bi.id, 'bill_id', bi.bill_id, 'item_id', bi.item_id,
               'name', bi.name, 'emoji', bi.emoji, 'image_url', bi.image_url,
               'unit', bi.unit, 'qty', bi.qty, 'price', bi.price
             ) order by bi.line_no nulls last, bi.name)
      from public.bill_items bi where bi.bill_id = b.id), '[]'::jsonb)
  )
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where b.id = p_id
$$;
revoke execute on function public.bill_payload(uuid) from public;

-- ─── generate_bill: idempotent, and returns its own lines ───────────────────
-- Reproduced from 0028 with three changes: the p_client_ref replay guard, the
-- line_no on each bill_item, and a jsonb return carrying the stored lines.
-- Return type changed, so the old signature has to go first.
drop function if exists public.generate_bill(jsonb, jsonb, text);
create or replace function public.generate_bill(
  customer jsonb, lines jsonb, p_tz text default 'UTC', p_client_ref uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric; v_no int := 0;
        v_type text; v_disc numeric := 0; v_amt numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
        v_existing uuid;
begin
  if not public.has_perm('bill.create') then raise exception 'forbidden'; end if;
  -- A biller without bill.discount cannot smuggle one in through the payload.
  if coalesce((customer->>'discount')::numeric, 0) > 0
     and not public.has_perm('bill.discount') then
    raise exception 'not allowed to apply a discount';
  end if;

  -- A retried checkout — the bill committed but the response was lost on the
  -- way back — must return the bill that already exists, not ring up a second.
  if p_client_ref is not null then
    select id into v_existing from public.bills where client_ref = p_client_ref;
    if found then return public.bill_payload(v_existing); end if;
  end if;

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

  begin
    insert into public.bills (customer_name, customer_phone, customer_id,
                              subtotal, tax, total, tax_rate, payment_method,
                              discount_percent, discount_type, discount_amount,
                              created_by, client_ref)
      values (coalesce(customer->>'name',''), v_phone, v_customer,
              v_sub, v_tax, round(v_taxable + v_tax, 2), v_rate,
              case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
              v_disc, v_type, v_amt, auth.uid(), p_client_ref)
      returning * into v_bill;
  exception when unique_violation then
    -- client_ref is the only unique constraint this insert can hit; anything
    -- else is a real error and must not be swallowed as a replay.
    if p_client_ref is null then raise; end if;
    -- Two retries raced past the check above; the one that committed wins and
    -- no stock is consumed on this path.
    select id into v_existing from public.bills where client_ref = p_client_ref;
    return public.bill_payload(v_existing);
  end;

  for ln in select * from jsonb_array_elements(lines) loop
    v_no := v_no + 1;
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty,
                                   price, cost_price, image_url, line_no)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty,
              it.price, it.cost_price, it.image_url, v_no);
    perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ' order by line_no) from public.bill_items
              where bill_id = v_bill.id),
            v_bill.total);
  return public.bill_payload(v_bill.id);
end $$;
grant execute on function public.generate_bill(jsonb, jsonb, text, uuid) to authenticated;
