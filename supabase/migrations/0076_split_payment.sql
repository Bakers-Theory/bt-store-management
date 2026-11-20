-- ============================================================================
-- BT Store Management — split payment (Cash + UPI) on a bill
--
-- A customer often settles one bill partly in cash and partly over UPI. The
-- bill now takes a third payment method, 'Both', and records how much of the
-- total came in each way. The cash book is credited per mode — the cash part to
-- the cash account, the UPI part to the bank — so the day's settlement adds up
-- without counting the bill twice.
--
-- The client sends only `upiAmount`; the cash part is DERIVED as total − UPI.
-- Any extra cash the customer handed over is change returned at the counter,
-- not money the store keeps, so it never reaches the books. A split bill can
-- therefore never be short-paid.
-- ============================================================================

alter table public.bills drop constraint if exists bills_payment_method_check;
alter table public.bills
  add constraint bills_payment_method_check
    check (payment_method in ('Cash','UPI','Both'));

-- 0 on a single-mode bill: the whole total went the one way.
alter table public.bills
  add column if not exists cash_amount numeric(12,2) not null default 0,
  add column if not exists upi_amount  numeric(12,2) not null default 0;

-- ─── bills_v: recreate so the new columns surface (b.* is frozen at create) ──
-- Reproduced from 0070; the predicate is unchanged.
drop view if exists public.bills_v;
create view public.bills_v as
  select b.*, p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('bill.history') or public.has_perm('bill.create')
     or public.has_perm('dashboard.view') or public.has_perm('reports.view');
grant select on public.bills_v to authenticated;

-- ─── generate_bill: accept and post a split payment ────────────────────────
-- Reproduced from 0073 with the blocks marked ADDED (0076). Every other line is
-- 0073 verbatim.
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
        v_inv_type text; v_store public.store_settings;
        v_gstin text; v_pos text; v_inter boolean := false;
        v_incl boolean; v_fy text; v_inv_no text;
        v_taxable numeric := 0; v_cgst numeric := 0; v_sgst numeric := 0;
        v_igst numeric := 0; v_missing text;
        v_amounts numeric[] := '{}'; v_rates numeric[] := '{}';
        v_shares numeric[] := '{}';
        v_n int; v_i int; v_alloc numeric := 0; v_last int := 0;
        v_net numeric; v_ltax numeric; v_ltaxable numeric;
        v_lcgst numeric; v_lsgst numeric; v_ligst numeric;
        v_loy_on boolean := false; v_occ text;
        v_pts_req integer := 0; v_pts_bal integer := 0;
        v_manual numeric := 0; v_occ_amt numeric := 0; v_red_amt numeric := 0;
        v_pts_red integer := 0; v_pts_earn integer := 0;
        v_over numeric; v_cut numeric;
        v_dob date; v_anniv date; v_today date; v_feb28 boolean := false;
        v_prior_dob date; v_prior_anniv date;
        -- ADDED (0073)
        v_mode text; v_price numeric; v_cmode text; v_cunit text;
        -- ADDED (0076)
        v_pay text := case customer->>'payment'
                        when 'UPI' then 'UPI' when 'Both' then 'Both' else 'Cash' end;
        v_upi numeric := 0; v_cash numeric := 0;
begin
  if not public.has_perm('bill.create') then raise exception 'forbidden'; end if;
  if coalesce((customer->>'discount')::numeric, 0) > 0
     and not public.has_perm('bill.discount') then
    raise exception 'not allowed to apply a discount';
  end if;

  if coalesce((customer->>'redeemPoints')::integer, 0) > 0
     and not public.has_perm('loyalty.redeem') then
    raise exception 'not allowed to redeem points';
  end if;

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

  v_inv_type := case when customer->>'invoiceType' = 'gst' then 'gst' else 'non_gst' end;
  v_incl := coalesce(v_store.prices_include_gst, true);

  if v_inv_type = 'gst' then
    if coalesce(btrim(v_store.gst), '') = '' then
      raise exception 'add the store GSTIN in Settings before raising a GST invoice';
    end if;
    if coalesce(btrim(v_store.gst_state_code), '') = '' then
      raise exception 'add the store state code in Settings before raising a GST invoice';
    end if;
    v_gstin := upper(btrim(coalesce(customer->>'gstin','')));
    if v_gstin <> '' and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'that GSTIN does not look right';
    end if;
    v_pos := coalesce(nullif(btrim(coalesce(customer->>'placeOfSupply','')), ''),
                      nullif(left(v_gstin, 2), ''),
                      v_store.gst_state_code);
    v_inter := v_pos <> v_store.gst_state_code;
  else
    v_gstin := '';
    v_pos := '';
    v_inter := false;
  end if;

  -- ─── pass 1: price and validate every line before the bill row exists ─────
  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    if v_inv_type = 'gst' and coalesce(btrim(it.hsn),'') = '' then
      v_missing := coalesce(v_missing || ', ', '') || it.name;
    end if;

    -- ADDED (0073): note 5. The mode decides the price, and a piece line on an
    -- item with no pack size is rejected here rather than priced as a pack.
    v_mode := case when ln->>'sellMode' = 'piece' then 'piece' else 'pack' end;
    if v_mode = 'piece' and it.pack_size is null then
      raise exception '% is not sold in packs, so it cannot be billed by the piece', it.name;
    end if;
    v_price := case when v_mode = 'piece'
                    then public.piece_price(it.price, it.pack_size)
                    else it.price end;

    v_sub := v_sub + round(v_qty * v_price, 2);
    v_amounts := v_amounts || round(v_qty * v_price, 2);
    v_rates := v_rates || case when v_inv_type = 'gst' then it.gst_rate else 0 end;
  end loop;

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

    -- ADDED (0073): the same rule as an item line, on the consumable's cost.
    v_cmode := case when cn->>'sellMode' = 'piece' then 'piece' else 'pack' end;
    if v_cmode = 'piece' and cc.pack_size is null then
      raise exception '% is not sold in packs, so it cannot be billed by the piece', cc.name;
    end if;
    v_ccost := case when v_cmode = 'piece'
                    then public.piece_price(coalesce(cc.cost_per_unit, 0), cc.pack_size)
                    else coalesce(cc.cost_per_unit, 0) end;

    if v_charged and v_ccost <= 0 then
      raise exception 'set a cost per unit on % before charging it on a bill', cc.name;
    end if;
    if v_charged and v_inv_type = 'gst' and coalesce(btrim(cc.hsn),'') = '' then
      v_missing := coalesce(v_missing || ', ', '') || cc.name;
    end if;

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
    select c.dob, c.anniversary into v_prior_dob, v_prior_anniv
      from public.customers c where c.phone = v_phone for update;

    v_dob := nullif(btrim(coalesce(customer->>'dob','')), '')::date;
    v_anniv := nullif(btrim(coalesce(customer->>'anniversary','')), '')::date;
    insert into public.customers (phone, name, dob, anniversary)
      values (v_phone, coalesce(customer->>'name',''), v_dob, v_anniv)
      on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name
                        else public.customers.name end,
            dob = coalesce(public.customers.dob, excluded.dob),
            anniversary = coalesce(public.customers.anniversary, excluded.anniversary),
            last_seen = now()
      returning id, points_balance
      into v_customer, v_pts_bal;
  end if;

  v_loy_on := coalesce(v_store.loyalty_enabled, false) and v_customer is not null;
  if v_loy_on then
    v_today := v_on;
    v_feb28 := extract(month from v_today) = 2
               and extract(day from v_today) = 28
               and not public.is_leap_year(extract(year from v_today)::int);
    if v_prior_dob is not null
       and ((extract(month from v_prior_dob) = extract(month from v_today)
             and extract(day from v_prior_dob) = extract(day from v_today))
            or (v_feb28 and extract(month from v_prior_dob) = 2
                and extract(day from v_prior_dob) = 29)) then
      v_occ := 'birthday';
    elsif v_prior_anniv is not null
       and ((extract(month from v_prior_anniv) = extract(month from v_today)
             and extract(day from v_prior_anniv) = extract(day from v_today))
            or (v_feb28 and extract(month from v_prior_anniv) = 2
                and extract(day from v_prior_anniv) = 29)) then
      v_occ := 'anniversary';
    end if;
  end if;

  v_type := case when customer->>'discountType' = 'flat' then 'flat' else 'percent' end;
  if v_type = 'flat' then
    v_manual := greatest(0, round(coalesce((customer->>'discount')::numeric, 0), 2));
  else
    v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
    v_manual := round(v_sub * v_disc / 100, 2);
  end if;

  if v_loy_on and v_occ is not null then
    v_occ_amt := least(
      round(v_sub * least(100, greatest(0, v_store.occasion_discount_percent)) / 100, 2),
      v_store.occasion_discount_cap);
  end if;

  if v_loy_on then
    v_pts_req := greatest(0, coalesce((customer->>'redeemPoints')::integer, 0));
    if v_pts_req > 0 then
      if v_pts_req > v_pts_bal then
        raise exception 'that customer only has % points', v_pts_bal;
      end if;
      if v_pts_req < v_store.min_redeem_points then
        raise exception 'at least % points are needed to redeem', v_store.min_redeem_points;
      end if;
      v_red_amt := round(v_pts_req::numeric / v_store.points_per_rupee, 2);
    end if;
  elsif coalesce((customer->>'redeemPoints')::integer, 0) > 0 then
    raise exception 'the loyalty programme is not available on this bill';
  end if;

  v_over := round(v_manual + v_occ_amt + v_red_amt - v_sub, 2);
  if v_over > 0 then
    v_cut := least(v_red_amt, v_over);
    v_red_amt := round(v_red_amt - v_cut, 2); v_over := round(v_over - v_cut, 2);
    v_cut := least(v_occ_amt, v_over);
    v_occ_amt := round(v_occ_amt - v_cut, 2); v_over := round(v_over - v_cut, 2);
    v_cut := least(v_manual, v_over);
    v_manual := round(v_manual - v_cut, 2);
  end if;
  if v_occ_amt = 0 then v_occ := null; end if;
  v_pts_red := round(v_red_amt * v_store.points_per_rupee)::integer;

  v_amt := round(v_manual + v_occ_amt + v_red_amt, 2);

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

  v_fy := public.financial_year(v_on);
  v_inv_no := public.next_invoice_no(v_inv_type, v_fy);

  begin
    insert into public.bills (customer_name, customer_phone, customer_id,
                              subtotal, tax, total, tax_rate, payment_method,
                              discount_percent, discount_type, discount_amount,
                              created_by, client_ref,
                              invoice_type, invoice_no, customer_gstin,
                              place_of_supply, is_interstate,
                              taxable_value, cgst, sgst, igst,
                              occasion_kind, occasion_discount,
                              points_redeemed, points_redeem_value)
      values (coalesce(customer->>'name',''), v_phone, v_customer,
              v_sub, v_tax, round(v_taxable + v_tax, 2), 0,
              v_pay,                                                 -- ADDED (0076)
              v_disc, v_type, v_amt, auth.uid(), p_client_ref,
              v_inv_type, v_inv_no, v_gstin, v_pos, v_inter,
              v_taxable, v_cgst, v_sgst, v_igst,
              v_occ, v_occ_amt, v_pts_red, v_red_amt)
      returning * into v_bill;
  exception when unique_violation then
    if p_client_ref is null then raise; end if;
    select id into v_existing from public.bills where client_ref = p_client_ref;
    return public.bill_payload(v_existing);
  end;

  -- ─── pass 2: store each line with its own share of the tax ────────────────
  for ln in select * from jsonb_array_elements(lines) loop
    v_no := v_no + 1;
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    -- ADDED (0073): re-derived, never carried across the two passes, so the
    -- stored line and the priced line cannot disagree.
    v_mode := case when ln->>'sellMode' = 'piece' then 'piece' else 'pack' end;
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
                                   hsn, gst_rate, taxable_value, cgst, sgst, igst,
                                   sell_mode, pack_size)              -- ADDED (0073)
      values (v_bill.id, it.id, it.name, it.emoji,
              -- Note 6: a piece line prints "pcs", not the pack's own label.
              case when v_mode = 'piece' then 'pcs' else it.unit end,
              v_qty,
              case when v_mode = 'piece'
                   then public.piece_price(it.price, it.pack_size)
                   else it.price end,
              -- The cost follows the same split, so margin on a piece line is
              -- the margin on the pack it came out of.
              case when v_mode = 'piece'
                   then public.piece_price(it.cost_price, it.pack_size)
                   else it.cost_price end,
              it.image_url, v_no,
              case when v_inv_type = 'gst' then it.hsn else '' end,
              v_rates[v_no], v_ltaxable, v_lcgst, v_lsgst, v_ligst,
              v_mode, case when v_mode = 'piece' then it.pack_size end);
    -- ADDED (0073): note 3. The pack opens itself on the way out.
    if v_mode = 'piece' then
      perform public.consume_pieces(it.id, v_qty, p_tz);
    else
      perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
    end if;
  end loop;

  for cn in select * from jsonb_array_elements(p_consumables) loop
    v_cno := v_cno + 1;
    v_cqty := round(coalesce((cn->>'qty')::numeric, 0), 3);
    v_charged := coalesce((cn->>'charged')::boolean, false);
    select * into cc from public.consumable where id = (cn->>'consumableId')::uuid;
    -- ADDED (0073)
    v_cmode := case when cn->>'sellMode' = 'piece' then 'piece' else 'pack' end;
    v_cunit := case when v_cmode = 'piece' then 'pcs' else cc.unit end;
    v_ccost := case when v_cmode = 'piece'
                    then public.piece_price(coalesce(cc.cost_per_unit, 0), cc.pack_size)
                    else coalesce(cc.cost_per_unit, 0) end;
    v_mv := public.issue_consumable_for_bill(cc.id, v_cqty, v_on, v_bill.bill_no, v_cmode);

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
      hsn, gst_rate, taxable_value, cgst, sgst, igst,
      sell_mode, pack_size)                                          -- ADDED (0073)
    values (
      v_bill.id, cc.id, v_mv, cc.name, v_cunit, v_cqty,
      v_ccost, v_charged, v_cno,
      case when v_inv_type = 'gst' and v_charged then cc.hsn else '' end,
      case when v_inv_type = 'gst' and v_charged then cc.gst_rate else 0 end,
      v_ltaxable, v_lcgst, v_lsgst, v_ligst,
      v_cmode, case when v_cmode = 'piece' then cc.pack_size end);
  end loop;

  -- ADDED (0076): a split must leave a real amount on BOTH sides. The cash
  -- part is whatever UPI did not cover, so it is exact by construction.
  if v_pay = 'Both' then
    v_upi  := round(coalesce(nullif(customer->>'upiAmount', '')::numeric, 0), 2);
    v_cash := round(v_bill.total - v_upi, 2);
    if v_upi <= 0 or v_cash <= 0 then
      raise exception 'a split payment needs both a cash and a UPI amount above zero';
    end if;
    update public.bills set cash_amount = v_cash, upi_amount = v_upi
      where id = v_bill.id
      returning * into v_bill;
  end if;

  -- ADDED (0076): a split bill is paid in full by definition, so `received`
  -- is ignored rather than turned into a shortfall.
  v_recv  := case when v_pay = 'Both' then v_bill.total
                  else coalesce(nullif(customer->>'received', '')::numeric, v_bill.total) end;
  v_short := least(v_bill.total, greatest(0, round(v_bill.total - v_recv, 2)));
  if v_short > 0 then
    v_snote := left(btrim(coalesce(customer->>'shortfallNote', '')), 200);
    update public.bills set shortfall = v_short, shortfall_note = v_snote
      where id = v_bill.id
      returning * into v_bill;
  end if;

  if v_loy_on then
    if v_pts_red > 0 then
      perform public.append_loyalty(v_customer, v_bill.id, 'redeem', -v_pts_red,
        'redeemed on bill #' || v_bill.bill_no);
    end if;
    if coalesce(v_store.points_amount_unit, 0) > 0 then
      v_pts_earn := floor(v_bill.total / v_store.points_amount_unit)::integer
                    * v_store.points_per_amount;
    end if;
    if v_pts_earn > 0 then
      perform public.append_loyalty(v_customer, v_bill.id, 'earn', v_pts_earn,
        'earned on bill #' || v_bill.bill_no);
      update public.bills set points_earned = v_pts_earn where id = v_bill.id
        returning * into v_bill;
    end if;
  end if;

  -- ADDED (0076): a split posts one entry per mode; together they are the total.
  if v_pay = 'Both' then
    perform public.post_cash(
      v_on, 'in', v_cash, 'Cash',
      public.system_category('Sales'), 'bill', v_bill.id,
      'Split payment — cash part', '', null, null);
    perform public.post_cash(
      v_on, 'in', v_upi, 'UPI',
      public.system_category('Sales'), 'bill', v_bill.id,
      'Split payment — UPI part', '', null, null);
  elsif v_bill.total > 0 then
    perform public.post_cash(
      v_on, 'in', v_bill.total, v_bill.payment_method,
      public.system_category('Sales'), 'bill', v_bill.id,
      '', '', null, null);
  end if;

  if v_absorbed > 0 then
    perform public.post_cash(
      v_on, 'out', v_absorbed,
      case when v_pay = 'Both' then 'Cash' else v_bill.payment_method end, -- ADDED (0076)
      public.system_category('Consumables Used'), 'bill', v_bill.id,
      'Consumables used on bill #' || v_bill.bill_no, '', null, null);
  end if;

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
