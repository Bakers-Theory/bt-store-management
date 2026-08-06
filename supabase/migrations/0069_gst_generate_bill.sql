-- ============================================================================
-- BT Store Management — customer invoice types, part 2: the bill
--
-- Design: docs/superpowers/specs/2026-08-05-customer-invoice-types-design.md
-- Plan:   docs/superpowers/plans/2026-08-06-customer-invoice-types.md
--
-- generate_bill is reproduced from 0067_bill_consumables.sql. The SIGNATURE IS
-- UNCHANGED — all five parameters stay — so the grant and the PostgREST call
-- site in src/lib/supabase-data.ts do not move. Only the tax block, the
-- invoice-number claim and the per-line snapshot are new; the replay guard,
-- store-open check, cash-day assertion, FIFO consumption, shortfall handling,
-- cash posting and activity log are 0067 verbatim.
--
--   1. THE SERVER IS AUTHORITATIVE. is_interstate is DERIVED here, never taken
--      from the client, because it decides whether the tax is one levy or two.
--      The client mirrors every rule below only so the biller sees the problem
--      before pressing the button with a customer waiting.
--   2. THE TYPESCRIPT MIRROR IS `src/lib/gst.ts`. Same formulae, same rounding
--      ORDER, same residue rules (discount residue to the last non-zero line,
--      odd tax paisa to CGST). Change one, change the other, in the same commit
--      — otherwise the on-screen preview and the printed invoice drift apart.
--   3. A NON-GST BILL STORES NO GST DATA AT ALL, even when the payload carries a
--      GSTIN and a place of supply. A mistyped invoice type therefore cannot
--      leak a customer's GSTIN onto a plain counter bill.
--   4. THE NUMBER IS CLAIMED INSIDE THE BILL'S TRANSACTION, so a rolled-back
--      bill does not consume one and the series stays gapless. A CANCELLED bill
--      KEEPS its number — cancel_bill is deliberately untouched.
--   5. `subtotal` IS NOW THE SUM OF THE ROUNDED LINE AMOUNTS, where 0067 summed
--      the raw products and rounded once at the end. The two differ only when a
--      qty × price lands below the paisa, and an invoice whose subtotal is not
--      the sum of its own printed lines is indefensible. This also makes the
--      discount allocation's denominator identical to gst.ts's.
-- ============================================================================

-- ─── financial_year: April to March ─────────────────────────────────────────
-- Takes a date the caller has ALREADY converted to the store timezone, because
-- a bill rung up at 01:30 IST on 1 April belongs to the new year even though it
-- is still 31 March in UTC. Mirrors financialYear() in src/lib/gst.ts.
create or replace function public.financial_year(p_on date)
returns text language sql immutable set search_path = public as $$
  select v.start_year::text || '-' || lpad(((v.start_year + 1) % 100)::text, 2, '0')
  from (
    select case when extract(month from p_on) >= 4
                then extract(year from p_on)::int
                else extract(year from p_on)::int - 1
           end as start_year
  ) v
$$;

-- ─── next_invoice_no: claim one number, atomically ──────────────────────────
-- The upsert both inserts the first number of a year and increments every one
-- after it in a single statement, so two concurrent checkouts cannot collide.
-- Zero-padded to four digits and widening beyond that on its own.
create or replace function public.next_invoice_no(p_series text, p_fy text)
returns text language plpgsql security definer set search_path = public as $$
declare v_seq int;
begin
  insert into public.invoice_counter (series, fy, next_no) values (p_series, p_fy, 2)
    on conflict (series, fy) do update set next_no = public.invoice_counter.next_no + 1
    returning next_no - 1 into v_seq;
  return case when p_series = 'gst' then 'GST/' else 'INV/' end
         || p_fy || '/' || lpad(v_seq::text, 4, '0');
end $$;
revoke execute on function public.next_invoice_no(text, text) from public;

-- ─── bill_payload: carry the six GST columns on every line ──────────────────
-- Reproduced from 0067 with the ADDED keys. cost_price stays out, as in 0031.
create or replace function public.bill_payload(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bill', to_jsonb(b) - 'client_ref' || jsonb_build_object('biller_name', p.name),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bi.id, 'bill_id', bi.bill_id, 'item_id', bi.item_id,
               'name', bi.name, 'emoji', bi.emoji, 'image_url', bi.image_url,
               'unit', bi.unit, 'qty', bi.qty, 'price', bi.price,
               'hsn', bi.hsn, 'gst_rate', bi.gst_rate,              -- ADDED (0069)
               'taxable_value', bi.taxable_value,                   -- ADDED (0069)
               'cgst', bi.cgst, 'sgst', bi.sgst, 'igst', bi.igst    -- ADDED (0069)
             ) order by bi.line_no nulls last, bi.name)
      from public.bill_items bi where bi.bill_id = b.id), '[]'::jsonb),
    'consumables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bc.id, 'consumable_id', bc.consumable_id,
               'name', bc.name, 'unit', bc.unit, 'qty', bc.qty,
               'unit_cost', bc.unit_cost, 'charged', bc.charged,
               'hsn', bc.hsn, 'gst_rate', bc.gst_rate,              -- ADDED (0069)
               'taxable_value', bc.taxable_value,                   -- ADDED (0069)
               'cgst', bc.cgst, 'sgst', bc.sgst, 'igst', bc.igst    -- ADDED (0069)
             ) order by bc.line_no)
      from public.bill_consumable bc where bc.bill_id = b.id), '[]'::jsonb)
  )
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where b.id = p_id
$$;
revoke execute on function public.bill_payload(uuid) from public;

-- ─── generate_bill ──────────────────────────────────────────────────────────
create or replace function public.generate_bill(
  customer jsonb, lines jsonb, p_tz text default 'UTC',
  p_client_ref uuid default null, p_consumables jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sub numeric := 0; v_tax numeric := 0; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric; v_no int := 0;
        v_type text; v_disc numeric := 0; v_amt numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
        v_existing uuid;
        v_recv numeric; v_short numeric := 0; v_snote text := ''; v_note text;
        cn jsonb; cc public.consumable; v_cqty numeric; v_cno int := 0;
        v_charged boolean; v_ccost numeric;
        v_csub numeric := 0; v_absorbed numeric := 0; v_mv uuid;
        v_on date;
        -- ADDED (0069)
        v_inv_type text; v_store public.store_settings;
        v_gstin text; v_pos text; v_inter boolean := false;
        v_incl boolean; v_fy text; v_inv_no text;
        v_taxable numeric := 0; v_cgst numeric := 0; v_sgst numeric := 0;
        v_igst numeric := 0; v_missing text;
        -- Pass 1 builds these parallel arrays — item lines first, then the
        -- CHARGED consumables, which is exactly the order gst.ts assembles its
        -- input in. Pass 2 reads the allocated discount back by index, so the
        -- two passes cannot disagree about which line got which share.
        v_amounts numeric[] := '{}'; v_rates numeric[] := '{}';
        v_shares numeric[] := '{}';
        v_n int; v_i int; v_alloc numeric := 0; v_last int := 0;
        v_net numeric; v_ltax numeric; v_ltaxable numeric;
        v_lcgst numeric; v_lsgst numeric; v_ligst numeric;
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

  select * into v_store from public.store_settings where id = 1;
  if not v_store.is_open then
    raise exception 'Store is closed — new bills cannot be created';
  end if;

  v_on := (now() at time zone p_tz)::date;
  perform public.assert_cash_day_open(v_on);

  -- ADDED (0069): the invoice type, and the rules that go with it.
  v_inv_type := case when customer->>'invoiceType' = 'gst' then 'gst' else 'non_gst' end;
  v_incl := coalesce(v_store.prices_include_gst, true);

  if v_inv_type = 'gst' then
    -- Rule 1: a tax invoice needs the supplier's own particulars, and the error
    -- names WHICH setting is missing so the fix is one click away.
    if coalesce(btrim(v_store.gst), '') = '' then
      raise exception 'add the store GSTIN in Settings before raising a GST invoice';
    end if;
    if coalesce(btrim(v_store.gst_state_code), '') = '' then
      raise exception 'add the store state code in Settings before raising a GST invoice';
    end if;
    -- Rule 3: the customer GSTIN is OPTIONAL. Blank is a legal B2C tax invoice,
    -- and the place of supply then falls back to the store's own state.
    v_gstin := upper(btrim(coalesce(customer->>'gstin','')));
    if v_gstin <> '' and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'that GSTIN does not look right';
    end if;
    v_pos := coalesce(nullif(btrim(coalesce(customer->>'placeOfSupply','')), ''),
                      nullif(left(v_gstin, 2), ''),
                      v_store.gst_state_code);
    -- Rule 4: derived, never trusted from the client.
    v_inter := v_pos <> v_store.gst_state_code;
  else
    -- Rule 5: no GST data on a non-GST bill, whatever the payload says.
    v_gstin := '';
    v_pos := '';
    v_inter := false;
  end if;

  -- ─── pass 1: price and validate every line before the bill row exists ─────
  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    -- Rule 2: a 0% rate is legal; a blank HSN is not. Collect ALL the offenders
    -- rather than raising on the first, so one trip fixes the whole basket.
    if v_inv_type = 'gst' and coalesce(btrim(it.hsn),'') = '' then
      v_missing := coalesce(v_missing || ', ', '') || it.name;
    end if;
    v_sub := v_sub + round(v_qty * it.price, 2);          -- CHANGED (0069), note 5
    v_amounts := v_amounts || round(v_qty * it.price, 2);
    v_rates := v_rates || case when v_inv_type = 'gst' then it.gst_rate else 0 end;
  end loop;

  -- The `for update` lock taken here is held to commit, which is what makes the
  -- stock check inside issue_consumable_for_bill hold under concurrency.
  for cn in select * from jsonb_array_elements(p_consumables) loop
    v_cqty := round(coalesce((cn->>'qty')::numeric, 0), 3);
    v_charged := coalesce((cn->>'charged')::boolean, false);
    select * into cc from public.consumable
      where id = (cn->>'consumableId')::uuid for update;
    if not found or cc.deleted_at is not null then
      raise exception 'that consumable no longer exists';
    end if;
    if cc.bill_mode = 'none' then
      raise exception '"%" is not available at billing', cc.name;
    end if;
    if v_cqty <= 0 then raise exception 'a quantity has to be more than zero'; end if;

    -- Note 2 of 0067: cost_per_unit is the price, so a charged line needs one.
    v_ccost := coalesce(cc.cost_per_unit, 0);
    if v_charged and v_ccost <= 0 then
      raise exception 'set a cost per unit on % before charging it on a bill', cc.name;
    end if;
    -- ADDED (0069): a charged line on a tax invoice is a supply like any other,
    -- so it is held to the same HSN rule. An ABSORBED line never reaches the
    -- customer and is therefore exempt.
    if v_charged and v_inv_type = 'gst' and coalesce(btrim(cc.hsn),'') = '' then
      v_missing := coalesce(v_missing || ', ', '') || cc.name;
    end if;

    -- Note 3 of 0067: charged lines join the subtotal and are taxed and
    -- discounted with everything else. Absorbed lines are money the store
    -- spends, not money the customer pays, so they stay out of it.
    if v_charged then
      v_csub := v_csub + round(v_cqty * v_ccost, 2);
      v_amounts := v_amounts || round(v_cqty * v_ccost, 2);
      v_rates := v_rates || case when v_inv_type = 'gst' then cc.gst_rate else 0 end;
    else
      v_absorbed := v_absorbed + v_cqty * v_ccost;
    end if;
  end loop;

  if v_missing is not null then
    raise exception 'set an HSN code on these before raising a GST invoice: %', v_missing;
  end if;

  v_sub := round(v_sub + v_csub, 2);
  v_absorbed := round(v_absorbed, 2);

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

  -- ─── allocate the discount pro-rata, residue to the last non-zero line ────
  -- Mirrors allocateDiscount() in src/lib/gst.ts. A split that does not add up
  -- would leave the invoice total and the line totals disagreeing.
  v_n := coalesce(array_length(v_amounts, 1), 0);
  for v_i in 1 .. v_n loop
    v_shares := v_shares || 0::numeric;
  end loop;
  if v_sub > 0 and v_amt > 0 then
    for v_i in 1 .. v_n loop
      if v_amounts[v_i] > 0 then
        v_last := v_i;
        v_shares[v_i] := round(v_amt * v_amounts[v_i] / v_sub, 2);
        v_alloc := round(v_alloc + v_shares[v_i], 2);
      end if;
    end loop;
    if v_last > 0 and v_alloc <> v_amt then
      v_shares[v_last] := round(v_shares[v_last] + (v_amt - v_alloc), 2);
    end if;
  end if;

  -- ─── per-line tax, summed into the invoice figures ────────────────────────
  -- Inclusive: the taxable value is backed out and the tax is the REMAINDER,
  -- not a second rounded multiplication — that is what makes taxable + tax
  -- equal the inclusive amount exactly, with no drift to explain away.
  for v_i in 1 .. v_n loop
    v_net := round(v_amounts[v_i] - v_shares[v_i], 2);
    if v_incl then
      v_ltaxable := round(v_net / (1 + v_rates[v_i] / 100), 2);
      v_ltax := round(v_net - v_ltaxable, 2);
    else
      v_ltaxable := v_net;
      v_ltax := round(v_ltaxable * v_rates[v_i] / 100, 2);
    end if;
    if v_inter then
      v_ligst := v_ltax; v_lcgst := 0; v_lsgst := 0;
    else
      -- The odd paisa goes to CGST so the two halves sum to the tax exactly.
      v_lsgst := round(floor(v_ltax * 100 / 2) / 100, 2);
      v_lcgst := round(v_ltax - v_lsgst, 2);
      v_ligst := 0;
    end if;
    v_taxable := round(v_taxable + v_ltaxable, 2);
    v_cgst := round(v_cgst + v_lcgst, 2);
    v_sgst := round(v_sgst + v_lsgst, 2);
    v_igst := round(v_igst + v_ligst, 2);
  end loop;
  v_tax := round(v_cgst + v_sgst + v_igst, 2);

  -- ADDED (0069): the number, claimed inside this transaction (note 4).
  v_fy := public.financial_year(v_on);
  v_inv_no := public.next_invoice_no(v_inv_type, v_fy);

  begin
    insert into public.bills (customer_name, customer_phone, customer_id,
                              subtotal, tax, total, tax_rate, payment_method,
                              discount_percent, discount_type, discount_amount,
                              created_by, client_ref,
                              invoice_type, invoice_no, customer_gstin,
                              place_of_supply, is_interstate,
                              taxable_value, cgst, sgst, igst)
      values (coalesce(customer->>'name',''), v_phone, v_customer,
              -- tax_rate is 0 on every new bill: rates live on the line now.
              -- Legacy rows keep whatever they were stamped with.
              v_sub, v_tax, round(v_taxable + v_tax, 2), 0,
              case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
              v_disc, v_type, v_amt, auth.uid(), p_client_ref,
              v_inv_type, v_inv_no, v_gstin, v_pos, v_inter,
              v_taxable, v_cgst, v_sgst, v_igst)
      returning * into v_bill;
  exception when unique_violation then
    -- client_ref is the only unique constraint this insert can hit that a
    -- retry would; anything else is a real error and must not be swallowed.
    if p_client_ref is null then raise; end if;
    -- Two retries raced past the check above; the one that committed wins and
    -- no stock is consumed on this path.
    select id into v_existing from public.bills where client_ref = p_client_ref;
    return public.bill_payload(v_existing);
  end;

  -- ─── pass 2: store each line with its own share of the tax ────────────────
  for ln in select * from jsonb_array_elements(lines) loop
    v_no := v_no + 1;
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    v_net := round(v_amounts[v_no] - v_shares[v_no], 2);
    if v_incl then
      v_ltaxable := round(v_net / (1 + v_rates[v_no] / 100), 2);
      v_ltax := round(v_net - v_ltaxable, 2);
    else
      v_ltaxable := v_net;
      v_ltax := round(v_ltaxable * v_rates[v_no] / 100, 2);
    end if;
    if v_inter then
      v_ligst := v_ltax; v_lcgst := 0; v_lsgst := 0;
    else
      v_lsgst := round(floor(v_ltax * 100 / 2) / 100, 2);
      v_lcgst := round(v_ltax - v_lsgst, 2);
      v_ligst := 0;
    end if;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty,
                                   price, cost_price, image_url, line_no,
                                   hsn, gst_rate, taxable_value, cgst, sgst, igst)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty,
              it.price, it.cost_price, it.image_url, v_no,
              case when v_inv_type = 'gst' then it.hsn else '' end,
              v_rates[v_no], v_ltaxable, v_lcgst, v_lsgst, v_ligst);
    perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
  end loop;

  -- The stock leaves, and the line is stored with a snapshot of what it was
  -- called and what it cost. `v_no` keeps counting from where the item lines
  -- left off, because that is where the charged consumables were appended to
  -- v_amounts in pass 1. An absorbed line does not advance it.
  for cn in select * from jsonb_array_elements(p_consumables) loop
    v_cno := v_cno + 1;
    v_cqty := round(coalesce((cn->>'qty')::numeric, 0), 3);
    v_charged := coalesce((cn->>'charged')::boolean, false);
    select * into cc from public.consumable where id = (cn->>'consumableId')::uuid;
    v_mv := public.issue_consumable_for_bill(cc.id, v_cqty, v_on, v_bill.bill_no);

    if v_charged then
      v_no := v_no + 1;
      v_net := round(v_amounts[v_no] - v_shares[v_no], 2);
      if v_incl then
        v_ltaxable := round(v_net / (1 + v_rates[v_no] / 100), 2);
        v_ltax := round(v_net - v_ltaxable, 2);
      else
        v_ltaxable := v_net;
        v_ltax := round(v_ltaxable * v_rates[v_no] / 100, 2);
      end if;
      if v_inter then
        v_ligst := v_ltax; v_lcgst := 0; v_lsgst := 0;
      else
        v_lsgst := round(floor(v_ltax * 100 / 2) / 100, 2);
        v_lcgst := round(v_ltax - v_lsgst, 2);
        v_ligst := 0;
      end if;
    else
      v_ltaxable := 0; v_lcgst := 0; v_lsgst := 0; v_ligst := 0;
    end if;

    insert into public.bill_consumable (
      bill_id, consumable_id, stock_movement_id, name, unit, qty,
      unit_cost, charged, line_no,
      hsn, gst_rate, taxable_value, cgst, sgst, igst)
    values (
      v_bill.id, cc.id, v_mv, cc.name, cc.unit, v_cqty,
      coalesce(cc.cost_per_unit, 0), v_charged, v_cno,
      case when v_inv_type = 'gst' and v_charged then cc.hsn else '' end,
      case when v_inv_type = 'gst' and v_charged then cc.gst_rate else 0 end,
      v_ltaxable, v_lcgst, v_lsgst, v_ligst);
  end loop;

  -- The gap, derived from the STORED total. nullif, not a plain coalesce — ''
  -- would raise on the ::numeric cast. An absent, blank or over-the-total
  -- `received` all mean "paid in full".
  v_recv  := coalesce(nullif(customer->>'received', '')::numeric, v_bill.total);
  v_short := least(v_bill.total, greatest(0, round(v_bill.total - v_recv, 2)));
  if v_short > 0 then
    v_snote := left(btrim(coalesce(customer->>'shortfallNote', '')), 200);
    update public.bills set shortfall = v_short, shortfall_note = v_snote
      where id = v_bill.id
      returning * into v_bill;
  end if;

  -- The sale posts to the ledger. A zero-total bill (a full discount) moved no
  -- money, so it posts nothing — post_cash requires amount > 0. The charged
  -- consumables are already inside v_bill.total, so this one posting still
  -- covers the whole sale, GST included: `total` did not change meaning here.
  if v_bill.total > 0 then
    perform public.post_cash(
      v_on, 'in', v_bill.total, v_bill.payment_method,
      public.system_category('Sales'), 'bill', v_bill.id,
      '', '', null, null);
  end if;

  -- What the store spent on the lines the customer never saw.
  if v_absorbed > 0 then
    perform public.post_cash(
      v_on, 'out', v_absorbed, v_bill.payment_method,
      public.system_category('Consumables Used'), 'bill', v_bill.id,
      'Consumables used on bill #' || v_bill.bill_no, '', null, null);
  end if;

  -- And the loss goes straight back out, same date and mode, so Sales stays
  -- equal to the sum of bill totals while the day nets to the cash actually
  -- taken. post_cash rejects a non-positive amount, hence the guard.
  if v_short > 0 then
    v_note := 'Short payment on bill #' || v_bill.bill_no
              || case when v_snote <> '' then ' — ' || v_snote else '' end;
    perform public.post_cash(
      v_on, 'out', v_short, v_bill.payment_method,
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
grant execute on function
  public.generate_bill(jsonb, jsonb, text, uuid, jsonb) to authenticated;

grant select (hsn, gst_rate, taxable_value, cgst, sgst, igst)
  on public.bill_items to authenticated;


-- ─── deliberately NOT touched ───────────────────────────────────────────────
-- cancel_bill, delete_bill, return_bill_consumables and cashbook_cogs are
-- correct as of 0067 and stay that way. A cancelled GST invoice KEEPS its
-- number, marked cancelled — that is what a gapless series requires, and
-- numbers are never reused. reverse_cash already loops every posting a bill
-- made, so the money reverses unchanged. Credit and debit notes are out of
-- scope; cancellation remains the only reversal.
