-- ============================================================================
-- BT Store Management — payment shortfall (a recorded, unrecoverable loss)
--
--   A ₹72 bill paid with ₹70. The store eats the ₹2. Booking that as a flat
--   discount would rewrite the bill to ₹70 and bury the loss inside revenue,
--   so instead the bill keeps its true total and the gap is recorded twice:
--   on the bill (`shortfall`) and in the cash book (`out` to a new system
--   category), leaving Sales equal to the sum of bill totals and the day's
--   net cash equal to what is actually in the drawer.
--
--   1. THE GAP IS STORED, NOT THE AMOUNT RECEIVED. `received` is then always
--      `total - shortfall`, so the two can never drift apart.
--   2. NO CAP, NO PERMISSION. Any biller may accept a short payment; the
--      activity log and the ledger category are the audit trail. Deliberate.
--   3. THE SERVER DOES THE SUBTRACTION. The client sends what it received;
--      the gap is derived from the stored total, never from the client.
--   4. CANCELLATION AND REPLAY NEED NO CHANGES. reverse_cash loops over every
--      entry for the bill, so both postings reverse; the client_ref guard
--      returns before any posting runs, so a retry cannot double-post.
-- ============================================================================

-- ─── Columns ────────────────────────────────────────────────────────────────
alter table public.bills
  add column if not exists shortfall numeric(12,2) not null default 0,
  add column if not exists shortfall_note text not null default '';

do $ck$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.bills'::regclass
                    and conname = 'bills_shortfall_non_negative') then
    alter table public.bills add constraint bills_shortfall_non_negative
      check (shortfall >= 0 and shortfall <= total);
  end if;
end $ck$;

-- ─── The category ───────────────────────────────────────────────────────────
-- System, because generate_bill names it on the auto-posting path: an admin
-- archiving it would break checkout. Top-level and childless, so it is a valid
-- posting target (0044, note 3).
insert into public.cash_category (name, direction, is_system, sort_order) values
  ('Payment Shortfall', 'out', true, 8)
on conflict do nothing;

-- ─── bills_v: recreate so the new columns surface (b.* is frozen at create) ──
-- Reproduced from 0028; the predicate is unchanged.
drop view if exists public.bills_v;
create view public.bills_v as
  select b.*, p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('bill.history') or public.has_perm('bill.create')
     or public.has_perm('dashboard.view') or public.has_perm('reports.view');
grant select on public.bills_v to authenticated;

-- ─── generate_bill: record and post the shortfall ───────────────────────────
-- Reproduced from 0047; only the two blocks marked ADDED (0055) are new.
create or replace function public.generate_bill(
  customer jsonb, lines jsonb, p_tz text default 'UTC', p_client_ref uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric; v_no int := 0;
        v_type text; v_disc numeric := 0; v_amt numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
        v_existing uuid;
        -- ADDED (0055)
        v_recv numeric; v_short numeric := 0; v_snote text := ''; v_note text;
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

  perform public.assert_cash_day_open((now() at time zone p_tz)::date);

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

  -- ADDED (0055): the gap, derived from the STORED total. nullif, not a plain
  -- coalesce — '' would raise on the ::numeric cast. An absent, blank or
  -- over-the-total `received` all mean "paid in full".
  v_recv  := coalesce(nullif(customer->>'received', '')::numeric, v_bill.total);
  v_short := least(v_bill.total, greatest(0, round(v_bill.total - v_recv, 2)));
  if v_short > 0 then
    v_snote := left(btrim(coalesce(customer->>'shortfallNote', '')), 200);
    update public.bills set shortfall = v_short, shortfall_note = v_snote
      where id = v_bill.id
      returning * into v_bill;
  end if;

  -- The sale posts to the ledger. A zero-total bill (a full discount) moved no
  -- money, so it posts nothing — post_cash requires amount > 0.
  if v_bill.total > 0 then
    perform public.post_cash(
      (now() at time zone p_tz)::date, 'in', v_bill.total, v_bill.payment_method,
      public.system_category('Sales'), 'bill', v_bill.id,
      '', '', null, null);
  end if;

  -- ADDED (0055): and the loss goes straight back out, same date and mode, so
  -- Sales stays equal to the sum of bill totals while the day nets to the cash
  -- actually taken. post_cash rejects a non-positive amount, hence the guard.
  if v_short > 0 then
    v_note := 'Short payment on bill #' || v_bill.bill_no
              || case when v_snote <> '' then ' — ' || v_snote else '' end;
    perform public.post_cash(
      (now() at time zone p_tz)::date, 'out', v_short, v_bill.payment_method,
      public.system_category('Payment Shortfall'), 'bill', v_bill.id,
      v_note, '', null, null);
  end if;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ' order by line_no) from public.bill_items
              where bill_id = v_bill.id),
            v_bill.total);
  return public.bill_payload(v_bill.id);
end $$;
grant execute on function public.generate_bill(jsonb, jsonb, text, uuid) to authenticated;
