-- ============================================================================
-- BT Store Management — wire the existing money RPCs into the cash ledger
--
--   Each function below is its CURRENT body with a post_cash / reverse_cash
--   call added, nothing else changed. The posting happens inside the existing
--   transaction, so a bill and its ledger row commit together or not at all.
--
--   `delete_salary_payment` is deliberately absent: it already refuses to touch
--   a paid record ("mark it unpaid first"), so a paid salary can only reach
--   deletion through mark_salary_unpaid — which does reverse. A hook there
--   would be dead code.
--
--   The three backdatable RPCs (mark_salary_paid, record_supplier_payment,
--   approve_advance) guard the POSTING date, not today, which is what makes a
--   backdated entry into a closed day impossible once phase B lands.
-- ============================================================================

-- ─── Bills ──────────────────────────────────────────────────────────────────
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

  -- ADDED: refuse before any stock moves, so a closed day cannot be billed into.
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

  -- ADDED: the sale posts to the ledger. A zero-total bill (a full discount)
  -- moved no money, so it posts nothing — post_cash requires amount > 0.
  if v_bill.total > 0 then
    perform public.post_cash(
      (now() at time zone p_tz)::date, 'in', v_bill.total, v_bill.payment_method,
      public.system_category('Sales'), 'bill', v_bill.id,
      '', '', null, null);
  end if;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ' order by line_no) from public.bill_items
              where bill_id = v_bill.id),
            v_bill.total);
  return public.bill_payload(v_bill.id);
end $$;

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
  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id;

  -- ADDED: the money goes back. If the sale's day is closed the reversal lands
  -- on the current open day instead of rewriting a counted day (phase B).
  perform public.reverse_cash('bill', p_id, 'cancelled by ' || p_by);

  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('cancel', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Cancelled by ' || p_by);
end $$;

create or replace function public.delete_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('bill.delete') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status <> 'cancelled' then
    for li in select * from public.bill_items where bill_id = p_id loop
      if li.item_id is not null then
        perform public.add_batch(li.item_id, li.qty, null);
      end if;
    end loop;
  end if;

  -- ADDED, BEFORE the delete: an already-cancelled bill was reversed by
  -- cancel_bill, and reverse_cash is idempotent, so this is a no-op there.
  -- The ledger rows survive the bill: source_id is deliberately not a FK.
  perform public.reverse_cash('bill', p_id, 'deleted by ' || p_by);

  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('delete', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Deleted by ' || p_by);
  delete from public.bills where id = p_id;   -- cascades bill_items
end $$;

-- ─── Supplier payments ──────────────────────────────────────────────────────
create or replace function public.record_supplier_payment(p jsonb)
returns public.supplier_payment_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.supplier_payment_v; v_id uuid;
  v_supplier uuid := (p->>'supplierId')::uuid;
  v_invoice uuid := nullif(p->>'invoiceId','')::uuid;
  v_type text; v_status text; v_name text;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_paid_on date := (p->>'paidOn')::date;
  v_mode text := coalesce(p->>'mode','');
  v_inv_supplier uuid; v_inv_status text;
begin
  if not public.has_perm('purchases.pay') then raise exception 'forbidden'; end if;
  -- The return row is read back through supplier_payment_v, which is gated on
  -- suppliers.view. Without it the write would succeed and then hand back NULL.
  if not public.has_perm('suppliers.view') then
    raise exception 'recording a payment also needs the "view suppliers" permission';
  end if;
  -- Recording a payment without being able to see amounts would mean filing a
  -- figure you cannot read back to check.
  if not public.has_perm('suppliers.financial') then
    raise exception 'recording a payment also needs the "view supplier money" permission';
  end if;

  if v_amount <= 0 then raise exception 'a payment must be more than zero'; end if;
  if v_mode not in ('Cash','UPI','Bank Transfer','Cheque') then
    raise exception 'choose a payment mode';
  end if;
  if v_paid_on is null then raise exception 'payment date required'; end if;
  if v_paid_on > current_date then
    raise exception 'a payment date cannot be in the future';
  end if;

  -- ADDED: a backdated payment into a closed day is refused (phase B).
  perform public.assert_cash_day_open(v_paid_on);

  select supplier_type, status, name into v_type, v_status, v_name
    from public.suppliers where id = v_supplier;
  if v_type is null then raise exception 'supplier not found'; end if;
  if v_type = 'in_house' then
    raise exception '% is in-house — there is nothing to pay', v_name;
  end if;
  -- An inactive supplier may still be owed money, so paying one is allowed.

  if v_invoice is not null then
    select supplier_id, status into v_inv_supplier, v_inv_status
      from public.purchase_invoice where id = v_invoice;
    if v_inv_supplier is null then raise exception 'invoice not found'; end if;
    if v_inv_supplier <> v_supplier then
      raise exception 'that invoice belongs to a different supplier';
    end if;
    if v_inv_status <> 'posted' then
      raise exception 'that invoice is % — only a posted invoice can be paid', v_inv_status;
    end if;
  end if;

  insert into public.supplier_payment (
    supplier_id, supplier_type, invoice_id, amount, paid_on, mode, reference_no, notes, created_by
  ) values (
    v_supplier, v_type, v_invoice, v_amount, v_paid_on, v_mode,
    btrim(coalesce(p->>'referenceNo','')), btrim(coalesce(p->>'notes','')), auth.uid()
  ) returning id into v_id;

  -- ADDED: money leaving for a supplier.
  perform public.post_cash(
    v_paid_on, 'out', v_amount, v_mode,
    public.system_category('Supplier Payment'), 'supplier_payment', v_id,
    btrim(coalesce(p->>'notes','')), btrim(coalesce(p->>'referenceNo','')), null, null);

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase_pay', auth.uid(), v_name, v_amount,
            'Paid ' || v_amount::text || ' to ' || v_name || ' by ' || v_mode
            || ' on ' || v_paid_on::text
            || case when v_invoice is not null
                    then ' against ' || (select invoice_no from public.purchase_invoice
                                         where id = v_invoice)
                    else ' on account' end);

  select * into v_row from public.supplier_payment_v where id = v_id;
  return v_row;
end $$;

create or replace function public.delete_supplier_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_amount numeric; v_paid_on date;
begin
  if not public.has_perm('purchases.pay') then raise exception 'forbidden'; end if;

  select s.name, sp.amount, sp.paid_on into v_name, v_amount, v_paid_on
  from public.supplier_payment sp join public.suppliers s on s.id = sp.supplier_id
  where sp.id = p_id;
  if not found then raise exception 'payment not found'; end if;

  -- ADDED: removing a payment puts the money back.
  perform public.reverse_cash('supplier_payment', p_id, 'payment removed');

  delete from public.supplier_payment where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase_pay', auth.uid(), v_name, v_amount,
            'Removed a payment of ' || v_amount::text || ' to ' || v_name
            || ' dated ' || v_paid_on::text);
end $$;

-- ─── Salary ─────────────────────────────────────────────────────────────────
create or replace function public.mark_salary_paid(
  p_id uuid, p_paid_on date, p_mode text, p_tz text default 'UTC'
)
returns public.salary_payment_v
language plpgsql security definer set search_path = public as $$
declare v_row public.salary_payment_v; v_name text; v_status text; v_net numeric;
begin
  if not public.has_perm('salary.pay') then raise exception 'forbidden'; end if;
  if p_mode is null or p_mode not in ('Cash','UPI') then
    raise exception 'choose a payment mode';
  end if;
  if p_paid_on is null then raise exception 'payment date required'; end if;
  if p_paid_on > (now() at time zone p_tz)::date then
    raise exception 'payment date cannot be in the future';
  end if;

  select p.name, sp.status, sp.net into v_name, v_status, v_net
  from public.salary_payment sp join public.profiles p on p.id = sp.profile_id
  where sp.id = p_id;
  if not found then raise exception 'payroll record not found'; end if;
  -- Story 4: the same period can never be paid twice.
  if v_status = 'paid' then raise exception 'this period is already marked paid'; end if;

  -- ADDED: a backdated payroll payment into a closed day is refused (phase B).
  perform public.assert_cash_day_open(p_paid_on);

  update public.salary_payment
    set status = 'paid', paid_on = p_paid_on, payment_mode = p_mode, recorded_by = auth.uid()
    where id = p_id;

  -- ADDED: `net`, not `gross` — the net is what left the drawer, after any
  -- advance recovery (0033).
  if v_net > 0 then
    perform public.post_cash(
      p_paid_on, 'out', v_net, p_mode, public.system_category('Salary'),
      'salary', p_id, '', '', null, null);
  end if;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('salary_pay', auth.uid(), v_name, v_net,
            'Paid ' || v_net::text || ' by ' || p_mode || ' on ' || p_paid_on::text);

  select * into v_row from public.salary_payment_v where id = p_id;
  return v_row;
end $$;

create or replace function public.mark_salary_unpaid(p_id uuid)
returns public.salary_payment_v
language plpgsql security definer set search_path = public as $$
declare v_row public.salary_payment_v; v_name text; v_net numeric;
begin
  if not public.has_perm('salary.pay') then raise exception 'forbidden'; end if;

  select p.name, sp.net into v_name, v_net
  from public.salary_payment sp join public.profiles p on p.id = sp.profile_id
  where sp.id = p_id;
  if not found then raise exception 'payroll record not found'; end if;

  update public.salary_payment
    set status = 'unpaid', paid_on = null, payment_mode = '', recorded_by = auth.uid()
    where id = p_id;

  -- ADDED: reopening payroll un-spends the money.
  perform public.reverse_cash('salary', p_id, 'payroll reopened');

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('salary_pay', auth.uid(), v_name, v_net, 'Reopened payroll (marked unpaid)');

  select * into v_row from public.salary_payment_v where id = p_id;
  return v_row;
end $$;

-- ─── Staff advances ─────────────────────────────────────────────────────────
create or replace function public.approve_advance(
  p_id uuid, p_approved_on date, p_mode text, p_tz text default 'UTC'
)
returns public.staff_advance_v
language plpgsql security definer set search_path = public as $$
declare v_row public.staff_advance_v; v_name text; v_status text;
        v_amount numeric; v_profile uuid;
begin
  if not public.has_perm('advance.approve') then raise exception 'forbidden'; end if;
  -- The return row is read back through staff_advance_v, which is gated on
  -- advance.view. Without it the write would succeed and then hand back NULL.
  if not public.has_perm('advance.view') then
    raise exception 'approving an advance also needs the "view advances" permission';
  end if;
  if p_mode is null or p_mode not in ('Cash','UPI') then
    raise exception 'choose a payment mode';
  end if;
  if p_approved_on is null then raise exception 'approval date required'; end if;
  if p_approved_on > (now() at time zone p_tz)::date then
    raise exception 'approval date cannot be in the future';
  end if;

  -- ADDED: a backdated approval into a closed day is refused (phase B).
  perform public.assert_cash_day_open(p_approved_on);

  select p.name, a.status, a.amount, a.profile_id
    into v_name, v_status, v_amount, v_profile
  from public.staff_advance a join public.profiles p on p.id = a.profile_id
  where a.id = p_id;
  if not found then raise exception 'advance not found'; end if;
  if v_status <> 'pending' then
    raise exception 'this advance has already been %', v_status;
  end if;

  -- Re-checked here, not only at request time: the salary may have been
  -- lowered, or another pending advance approved, in between.
  --
  -- Passing 0, NOT v_amount: this row is still `pending`, so advance_cap_check
  -- already counts it in its pending total. Approving only moves the amount
  -- from the pending term to the approved term, leaving the total unchanged.
  -- Passing v_amount would double-count it and reject legitimate approvals.
  perform public.advance_cap_check(v_profile, 0);

  update public.staff_advance
    set status = 'approved', approved_on = p_approved_on,
        payment_mode = p_mode, decided_by = auth.uid()
    where id = p_id;

  -- ADDED: the advance is cash handed over.
  perform public.post_cash(
    p_approved_on, 'out', v_amount, p_mode,
    public.system_category('Staff Advance'), 'advance', p_id, '', '', null, null);

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('advance_pay', auth.uid(), v_name, v_amount,
            'Approved advance ' || v_amount::text || ' by ' || p_mode
            || ' on ' || p_approved_on::text);

  select * into v_row from public.staff_advance_v where id = p_id;
  return v_row;
end $$;

create or replace function public.delete_advance(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_status text; v_amount numeric; v_profile uuid; v_bal numeric;
begin
  select p.name, a.status, a.amount, a.profile_id
    into v_name, v_status, v_amount, v_profile
  from public.staff_advance a join public.profiles p on p.id = a.profile_id
  where a.id = p_id;
  if not found then raise exception 'advance not found'; end if;

  if v_status = 'pending' then
    -- Unchanged from 0032: withdrawing a request you could have approved.
    if not public.has_perm('advance.approve') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('advance.delete') then raise exception 'forbidden'; end if;
  end if;

  -- Only an approved advance is inside the balance, so only it can strand a
  -- recovery. advance_balance_of is the same definition payroll uses.
  if v_status = 'approved' then
    v_bal := public.advance_balance_of(v_profile);
    if round(v_bal - v_amount, 2) < 0 then
      raise exception
        'this advance has already been recovered from salary — clear the recovery on the Payroll tab first';
    end if;
  end if;

  -- ADDED: only an approved advance ever moved money, and reverse_cash finds
  -- nothing for a pending or rejected one, so no status test is needed here.
  perform public.reverse_cash('advance', p_id, 'advance deleted');

  delete from public.staff_advance where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('advance', auth.uid(), v_name, v_amount,
            case v_status
              when 'pending'  then 'Removed a pending advance request'
              when 'approved' then 'Deleted an approved advance of ' || v_amount::text
              else 'Deleted a rejected advance request'
            end);
end $$;
