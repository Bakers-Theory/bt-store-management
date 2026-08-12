-- ============================================================================
-- BT Store Management — loyalty programme
--
-- Points earned on spend and redeemable as money off, plus an automatic
-- birthday/anniversary discount. OFF by default: with loyalty_enabled false
-- nothing accrues, nothing redeems, no occasion discount applies and no ledger
-- row is written, so an existing store is untouched until an owner opts in.
--
-- Notes
--   1. The three reductions on a bill — the biller's manual discount, the
--      occasion discount and points redemption — are NOT allocated separately.
--      They collapse into one rupee figure fed to the existing pro-rata
--      allocator, so the per-line GST split of 0069 is untouched. src/lib/
--      loyalty.ts mirrors the arithmetic here bit-for-bit.
--   2. When the three exceed the subtotal the overflow is cut back in a fixed
--      order — REDEMPTION first, then OCCASION, then MANUAL — so the biller's
--      own entry survives and points that would have bought nothing stay on
--      the balance. points_redeemed is recomputed from what survived.
--   3. loyalty_ledger is the authority on a balance; customers.points_balance
--      is a read cache maintained by the same RPCs that append to it. The same
--      shape the cash book and stock ledgers already use.
--   4. The occasion is derived SERVER-SIDE from customers.dob/anniversary
--      against today in p_tz. A client-sent occasion flag is never trusted.
--   5. bills.discount_amount keeps its meaning — the TOTAL money discounted —
--      and now spans all three sources. The manual part is recoverable as
--      discount_amount - occasion_discount - points_redeem_value, so every
--      existing report and receipt still reconciles.
-- ============================================================================

-- ─── store_settings: the owner's configuration ──────────────────────────────
alter table public.store_settings
  add column if not exists loyalty_enabled           boolean not null default false,
  add column if not exists points_per_amount         integer not null default 1,
  add column if not exists points_amount_unit        numeric not null default 100,
  add column if not exists points_per_rupee          integer not null default 10,
  add column if not exists min_redeem_points         integer not null default 100,
  add column if not exists occasion_discount_percent numeric not null default 10,
  add column if not exists occasion_discount_cap     numeric not null default 200;

alter table public.store_settings
  drop constraint if exists store_settings_loyalty_sane;
alter table public.store_settings
  add constraint store_settings_loyalty_sane check (
    points_per_amount >= 0
    and points_amount_unit > 0
    and points_per_rupee > 0
    and min_redeem_points >= 0
    and occasion_discount_percent between 0 and 100
    and occasion_discount_cap >= 0
  );

-- ─── customers: the dates and the cached balance ────────────────────────────
-- Both dates keep their year even though only month and day are ever compared:
-- discarding it would be irreversible, and age segmentation may want it later.
alter table public.customers
  add column if not exists dob            date,
  add column if not exists anniversary    date,
  add column if not exists points_balance integer not null default 0;

-- ─── loyalty_ledger ─────────────────────────────────────────────────────────
create table if not exists public.loyalty_ledger (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  bill_id     uuid references public.bills(id) on delete set null,
  kind        text not null check (kind in ('earn','redeem','reversal')),
  points      integer not null,          -- signed: earn +, redeem -, reversal either
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists loyalty_ledger_customer_idx
  on public.loyalty_ledger (customer_id, created_at desc);
create index if not exists loyalty_ledger_bill_idx
  on public.loyalty_ledger (bill_id);

-- Note 3: readable by anyone who can see the directory, written ONLY by the
-- security-definer RPCs below. No client insert/update/delete policy exists,
-- which with RLS on means those operations are refused outright.
alter table public.loyalty_ledger enable row level security;
drop policy if exists loyalty_ledger_read on public.loyalty_ledger;
create policy loyalty_ledger_read on public.loyalty_ledger for select
  using (public.has_perm('customers.view'));

-- ─── bills: what the loyalty programme did to this bill ─────────────────────
alter table public.bills
  add column if not exists occasion_kind       text
    check (occasion_kind is null or occasion_kind in ('birthday','anniversary')),
  add column if not exists occasion_discount   numeric not null default 0,
  add column if not exists points_redeemed     integer not null default 0,
  add column if not exists points_redeem_value numeric not null default 0,
  add column if not exists points_earned       integer not null default 0;

-- ─── bills_v: recreate so the new columns surface (b.* is frozen at create) ──
-- Reproduced from 0068; the predicate is unchanged.
drop view if exists public.bills_v;
create view public.bills_v as
  select b.*, p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('bill.history') or public.has_perm('bill.create')
     or public.has_perm('dashboard.view') or public.has_perm('reports.view');
grant select on public.bills_v to authenticated;

-- ─── save_settings: the loyalty block ───────────────────────────────────────
-- Reproduced from 0068 with an ADDED block and an ADDED permission branch: an
-- Admin holding loyalty.settings can configure the programme without also
-- being handed the whole store profile.
create or replace function public.save_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm('store.settings') or public.has_perm('loyalty.settings')) then
    raise exception 'forbidden';
  end if;

  -- The store profile is guarded on its own key: someone with only
  -- loyalty.settings must not be able to rename the shop through this call.
  if public.has_perm('store.settings') then
    update public.store_settings set
      name = coalesce(nullif(p->>'name',''), 'My Bakery'),
      tagline = coalesce(p->>'tagline',''),
      address = coalesce(p->>'address',''),
      phone = coalesce(p->>'phone',''),
      gst = coalesce(p->>'gst',''),
      currency = coalesce(nullif(p->>'currency',''),'₹'),
      tax_rate = coalesce((p->>'taxRate')::numeric, tax_rate),
      low_stock_alert = coalesce((p->>'lowStockAlert')::numeric, low_stock_alert),
      expiring_soon_days = coalesce((p->>'expiringSoonDays')::integer, expiring_soon_days),
      gst_state_code = btrim(coalesce(p->>'gstStateCode', gst_state_code)),
      prices_include_gst =
        coalesce((p->>'pricesIncludeGst')::boolean, prices_include_gst)
    where id = 1;
  end if;

  -- ADDED (0070)
  if public.has_perm('loyalty.settings') then
    update public.store_settings set
      loyalty_enabled =
        coalesce((p->>'loyaltyEnabled')::boolean, loyalty_enabled),
      points_per_amount =
        coalesce((p->>'pointsPerAmount')::integer, points_per_amount),
      points_amount_unit =
        coalesce((p->>'pointsAmountUnit')::numeric, points_amount_unit),
      points_per_rupee =
        coalesce((p->>'pointsPerRupee')::integer, points_per_rupee),
      min_redeem_points =
        coalesce((p->>'minRedeemPoints')::integer, min_redeem_points),
      occasion_discount_percent =
        coalesce((p->>'occasionDiscountPercent')::numeric, occasion_discount_percent),
      occasion_discount_cap =
        coalesce((p->>'occasionDiscountCap')::numeric, occasion_discount_cap)
    where id = 1;
  end if;

  insert into public.activity_log (type, actor, notes)
    values ('settings', auth.uid(), 'Updated store settings');
end $$;
grant execute on function public.save_settings(jsonb) to authenticated;

-- ─── update_customer: the two optional dates ────────────────────────────────
-- Reproduced from 0068 with two ADDED assignments. Either date may be cleared
-- by sending an explicit null; an ABSENT key leaves the stored date alone, so
-- a caller that does not know about these fields cannot wipe them.
-- points_balance is deliberately NOT writable here: it follows the ledger.
create or replace function public.update_customer(p_id uuid, p jsonb)
returns public.customers language plpgsql security definer set search_path = public as $$
declare v_row public.customers;
        v_phone text := nullif(btrim(p->>'phone'), '');
        v_gstin text := upper(btrim(coalesce(p->>'gstin','')));
        v_type  text := coalesce(nullif(p->>'defaultInvoiceType',''), 'non_gst');
begin
  if not public.has_perm('customers.edit') then raise exception 'forbidden'; end if;
  if v_phone is null then raise exception 'Phone number is required'; end if;
  if v_type not in ('gst','non_gst') then raise exception 'unknown invoice type'; end if;
  if v_gstin <> '' and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
    raise exception 'that GSTIN does not look right';
  end if;

  update public.customers
    set name = coalesce(p->>'name', ''),
        phone = v_phone,
        gstin = v_gstin,
        state_code = coalesce(nullif(btrim(p->>'stateCode'), ''), left(v_gstin, 2)),
        billing_address = btrim(coalesce(p->>'billingAddress','')),
        default_invoice_type = v_type,
        -- ADDED (0070)
        dob = case when p ? 'dob' then nullif(btrim(coalesce(p->>'dob','')), '')::date
                   else dob end,
        anniversary = case when p ? 'anniversary'
                           then nullif(btrim(coalesce(p->>'anniversary','')), '')::date
                           else anniversary end
    where id = p_id
    returning * into v_row;
  if not found then raise exception 'Customer not found'; end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'Another customer already uses that phone number';
end $$;
grant execute on function public.update_customer(uuid, jsonb) to authenticated;

-- ─── customers_with_stats / customer_by_phone: three more columns ───────────
-- Dropped rather than replaced: the return type changes, which
-- `create or replace function` refuses. Reproduced from 0068 otherwise.
drop function if exists public.customers_with_stats();
create or replace function public.customers_with_stats()
returns table (
  id                   uuid,
  phone                text,
  name                 text,
  first_seen           timestamptz,
  visit_count          bigint,
  total_spend          numeric,
  last_purchase        timestamptz,
  gstin                text,
  state_code           text,
  billing_address      text,
  default_invoice_type text,
  dob                  date,
  anniversary          date,
  points_balance       integer
)
language sql stable security definer set search_path = public as $$
  select c.id, c.phone, c.name, c.first_seen,
         count(b.id) filter (where b.status = 'active')            as visit_count,
         coalesce(sum(b.total) filter (where b.status = 'active'), 0) as total_spend,
         max(b.created_at) filter (where b.status = 'active')      as last_purchase,
         c.gstin, c.state_code, c.billing_address, c.default_invoice_type,
         c.dob, c.anniversary, c.points_balance
  from public.customers c
  left join public.bills b on b.customer_id = c.id
  where public.has_perm('customers.view')
  group by c.id
$$;
grant execute on function public.customers_with_stats() to authenticated;

drop function if exists public.customer_by_phone(text);
create or replace function public.customer_by_phone(p_phone text)
returns table (
  id                   uuid,
  phone                text,
  name                 text,
  first_seen           timestamptz,
  visit_count          bigint,
  total_spend          numeric,
  last_purchase        timestamptz,
  gstin                text,
  state_code           text,
  billing_address      text,
  default_invoice_type text,
  dob                  date,
  anniversary          date,
  points_balance       integer
)
language sql stable security definer set search_path = public as $$
  select c.id, c.phone, c.name, c.first_seen,
         count(b.id) filter (where b.status = 'active')            as visit_count,
         coalesce(sum(b.total) filter (where b.status = 'active'), 0) as total_spend,
         max(b.created_at) filter (where b.status = 'active')      as last_purchase,
         c.gstin, c.state_code, c.billing_address, c.default_invoice_type,
         c.dob, c.anniversary, c.points_balance
  from public.customers c
  left join public.bills b on b.customer_id = c.id
  where c.phone = p_phone
    and (public.has_perm('customers.view') or public.has_perm('bill.create'))
  group by c.id
$$;
grant execute on function public.customer_by_phone(text) to authenticated;

-- ─── append_loyalty: one place that writes the ledger and the cache ─────────
-- Every points movement goes through here, so the ledger and
-- customers.points_balance can never be updated by one path and not the other.
-- A zero movement writes nothing.
create or replace function public.append_loyalty(
  p_customer uuid, p_bill uuid, p_kind text, p_points integer, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_customer is null or coalesce(p_points, 0) = 0 then return; end if;
  insert into public.loyalty_ledger (customer_id, bill_id, kind, points, note)
    values (p_customer, p_bill, p_kind, p_points, coalesce(p_note, ''));
  update public.customers
    set points_balance = points_balance + p_points
    where id = p_customer;
end $$;
revoke execute on function public.append_loyalty(uuid, uuid, text, integer, text) from public;

-- ─── is_leap_year ───────────────────────────────────────────────────────────
-- Mirrors isLeapYear() in src/lib/loyalty.ts.
create or replace function public.is_leap_year(p_year int)
returns boolean language sql immutable as $$
  select (p_year % 4 = 0 and p_year % 100 <> 0) or p_year % 400 = 0
$$;

-- ─── generate_bill: the occasion discount, redemption and earning ───────────
-- Reproduced from 0069 with the blocks marked ADDED (0070). Every other line —
-- the permission checks, the replay guard, the `for update` locks, the GST
-- split, the shortfall handling and the cash postings — is 0069 verbatim.
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
        -- ADDED (0070)
        v_loy_on boolean := false; v_occ text;
        v_pts_req integer := 0; v_pts_bal integer := 0;
        v_manual numeric := 0; v_occ_amt numeric := 0; v_red_amt numeric := 0;
        v_pts_red integer := 0; v_pts_earn integer := 0;
        v_over numeric; v_cut numeric;
        v_dob date; v_anniv date; v_today date; v_feb28 boolean := false;
begin
  if not public.has_perm('bill.create') then raise exception 'forbidden'; end if;
  -- A biller without bill.discount cannot smuggle one in through the payload.
  if coalesce((customer->>'discount')::numeric, 0) > 0
     and not public.has_perm('bill.discount') then
    raise exception 'not allowed to apply a discount';
  end if;

  -- ADDED (0070): a biller without loyalty.redeem cannot burn a customer's
  -- points, the same shape as the bill.discount guard above.
  if coalesce((customer->>'redeemPoints')::integer, 0) > 0
     and not public.has_perm('loyalty.redeem') then
    raise exception 'not allowed to redeem points';
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
    -- ADDED (0070): the two dates are written on a NEW customer and filled in
    -- on an existing one ONLY when currently null. Billing never overwrites a
    -- date already on record — correcting one is the customer screen's job.
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
      returning id, dob, anniversary, points_balance
      into v_customer, v_dob, v_anniv, v_pts_bal;
  end if;

  -- ADDED (0070): note 4 — the occasion is derived here, from the STORED
  -- dates against today in the store timezone, and never read from the payload.
  v_loy_on := coalesce(v_store.loyalty_enabled, false) and v_customer is not null;
  if v_loy_on then
    v_today := v_on;
    -- A 29 February date matches 28 February in a non-leap year, so those
    -- customers are not skipped three years in four. Mirrors fallsToday().
    v_feb28 := extract(month from v_today) = 2
               and extract(day from v_today) = 28
               and not public.is_leap_year(extract(year from v_today)::int);
    -- The birthday is tested IN FULL — exact match or leap fallback — before
    -- the anniversary is looked at at all. That is occasionForToday()'s
    -- precedence: a birthday wins when both fall today, and a 29 February
    -- birthday still outranks a 28 February anniversary on 28 February.
    if v_dob is not null
       and ((extract(month from v_dob) = extract(month from v_today)
             and extract(day from v_dob) = extract(day from v_today))
            or (v_feb28 and extract(month from v_dob) = 2
                and extract(day from v_dob) = 29)) then
      v_occ := 'birthday';
    elsif v_anniv is not null
       and ((extract(month from v_anniv) = extract(month from v_today)
             and extract(day from v_anniv) = extract(day from v_today))
            or (v_feb28 and extract(month from v_anniv) = 2
                and extract(day from v_anniv) = 29)) then
      v_occ := 'anniversary';
    end if;
  end if;

  -- Flat clamps the ₹-off to the subtotal; percent clamps the rate to 0–100.
  v_type := case when customer->>'discountType' = 'flat' then 'flat' else 'percent' end;
  if v_type = 'flat' then
    v_manual := greatest(0, round(coalesce((customer->>'discount')::numeric, 0), 2));
  else
    v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
    v_manual := round(v_sub * v_disc / 100, 2);
  end if;

  -- ADDED (0070): notes 1 and 2. The occasion discount and the redemption are
  -- computed independently of the manual one — each capped against the SUBTOTAL,
  -- so neither silently shrinks another — and only the combined figure is
  -- clamped. Mirrors combinedDiscount() in src/lib/loyalty.ts.
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
    -- The programme is off, or the bill has no identified customer.
    raise exception 'the loyalty programme is not available on this bill';
  end if;

  -- Cut back the overflow: redemption first, then occasion, then manual.
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
  -- Note 2: burn only the points that actually bought something.
  v_pts_red := round(v_red_amt * v_store.points_per_rupee)::integer;

  -- Note 5: discount_amount is the TOTAL, and it is what the allocator splits.
  v_amt := round(v_manual + v_occ_amt + v_red_amt, 2);

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
                              taxable_value, cgst, sgst, igst,
                              -- ADDED (0070)
                              occasion_kind, occasion_discount,
                              points_redeemed, points_redeem_value)
      values (coalesce(customer->>'name',''), v_phone, v_customer,
              -- tax_rate is 0 on every new bill: rates live on the line now.
              -- Legacy rows keep whatever they were stamped with.
              v_sub, v_tax, round(v_taxable + v_tax, 2), 0,
              case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
              v_disc, v_type, v_amt, auth.uid(), p_client_ref,
              v_inv_type, v_inv_no, v_gstin, v_pos, v_inter,
              v_taxable, v_cgst, v_sgst, v_igst,
              -- ADDED (0070)
              v_occ, v_occ_amt, v_pts_red, v_red_amt)
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

  -- ADDED (0070): the ledger moves only now, when the bill is certain to exist.
  -- Earning is computed on v_bill.total — what the customer actually paid,
  -- after every discount — so points can never be farmed on the very discount
  -- they just bought. Points earned here are not redeemable on this bill.
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

-- ─── cancel_bill: reverse the points too ────────────────────────────────────
-- Reproduced from 0067 with one ADDED block. A balance may go negative if the
-- customer already spent points that are now clawed back; that is recorded
-- honestly rather than clamped, and the customer screen shows it as owed.
create or replace function public.cancel_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('bill.cancel') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status = 'cancelled' then raise exception 'already cancelled'; end if;
  for li in select * from public.bill_items where bill_id = p_id loop
    if li.item_id is not null then
      perform public.add_batch(li.item_id, li.qty, null);
    end if;
  end loop;

  -- ADDED (0067)
  perform public.return_bill_consumables(p_id, 'cancelled by ' || p_by);

  -- ADDED (0070): claw back what the bill earned, refund what it redeemed.
  -- Inside this same transaction as the stock and cash reversals.
  if v.customer_id is not null then
    if coalesce(v.points_earned, 0) > 0 then
      perform public.append_loyalty(v.customer_id, p_id, 'reversal',
        -v.points_earned, 'bill #' || v.bill_no || ' cancelled');
    end if;
    if coalesce(v.points_redeemed, 0) > 0 then
      perform public.append_loyalty(v.customer_id, p_id, 'reversal',
        v.points_redeemed, 'bill #' || v.bill_no || ' cancelled');
    end if;
  end if;

  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id;

  -- The money goes back. If the sale's day is closed the reversal lands on the
  -- current open day instead of rewriting a counted day (phase B).
  perform public.reverse_cash('bill', p_id, 'cancelled by ' || p_by);

  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('cancel', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Cancelled by ' || p_by);
end $$;

-- ─── bill_payload: no change needed ─────────────────────────────────────────
-- 0069's bill_payload builds its 'bill' key with `to_jsonb(b)`, so the five new
-- columns flow through with no re-creation here.
