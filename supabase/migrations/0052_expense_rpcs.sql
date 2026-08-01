-- ============================================================================
-- BT Store Management — expense workflow RPCs (Phase C)
--
--   1. TWO PATHS, ONE HOP. save_expense files a `pending` record; a caller who
--      holds expense.pay may pass paid=true to record and pay in one step.
--      pay_expense is the approver's route for someone else's pending record.
--   2. CASH MOVES ONLY AT `paid`, AND ONLY THROUGH post_cash. A Mixed expense
--      posts TWO rows sharing its source_id — one per account — which is why
--      cash_entry_source_uniq (0045) keys on `account`.
--   3. THE POSTING DATE IS paid_on, NOT expense_date. assert_cash_day_open
--      guards paid_on, so a payment cannot be backdated into a closed day.
--   4. NOTHING HERE TOUCHES supplier_summary_v. An expense against a supplier
--      does not reduce what is owed them.
--   5. A PAID EXPENSE IS CANCELLED, NEVER EDITED OR DELETED. Editing would
--      desynchronise the ledger; cancel_expense reverses the cash.
--
-- Applies on top of 0051, which creates public.expense and public.expense_event.
-- ============================================================================

-- Internal: one place that writes history, so no path can skip it.
create or replace function public.log_expense_event(
  p_expense_id uuid, p_event text, p_detail jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.expense_event (expense_id, event, actor, detail)
    values (p_expense_id, p_event, auth.uid(), coalesce(p_detail, '{}'::jsonb));
end $$;

revoke execute on function public.log_expense_event(uuid, text, jsonb) from public;

-- ─── save_expense: create or edit a pending expense ─────────────────────────
create or replace function public.save_expense(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_old public.expense;
  v_cat public.cash_category;
  v_date date := (p->>'expenseDate')::date;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_mode text := coalesce(p->>'paymentMode','');
  v_cash numeric := round(coalesce((p->>'splitCash')::numeric, 0), 2);
  v_bank numeric := round(coalesce((p->>'splitBank')::numeric, 0), 2);
  v_bank_mode text := coalesce(p->>'splitBankMode','');
  v_gst_inc boolean := coalesce((p->>'gstIncluded')::boolean, false);
  v_gst numeric := round(coalesce((p->>'gstAmount')::numeric, 0), 2);
  v_supplier uuid := nullif(p->>'vendorSupplierId','')::uuid;
  v_paid_by uuid := coalesce(nullif(p->>'paidById','')::uuid, auth.uid());
  v_pay boolean := coalesce((p->>'payNow')::boolean, false);
  v_diff jsonb := '{}'::jsonb;
begin
  if not public.has_perm('expense.create') then raise exception 'forbidden'; end if;

  -- ── Shared validation ────────────────────────────────────────────────────
  if v_amount <= 0 then raise exception 'an amount must be more than zero'; end if;
  if v_date is null then raise exception 'when was this spent?'; end if;
  if v_date > public.store_today() then
    raise exception 'an expense date cannot be in the future';
  end if;
  if v_mode not in ('Cash','UPI','Bank Transfer','Mixed') then
    raise exception 'choose a payment mode';
  end if;
  if v_gst_inc and (v_gst < 0 or v_gst >= v_amount) then
    raise exception 'the GST has to be less than the total, since it is included in it';
  end if;
  if not v_gst_inc then v_gst := 0; end if;

  if v_mode = 'Mixed' then
    if v_cash <= 0 or v_bank <= 0 then
      raise exception
        'a mixed payment needs both a cash and a bank amount, each more than zero';
    end if;
    if round(v_cash + v_bank, 2) <> v_amount then
      raise exception 'the cash and bank amounts must add up to the total';
    end if;
    if v_bank_mode not in ('UPI','Bank Transfer') then
      raise exception 'say whether the bank half was UPI or a bank transfer';
    end if;
  else
    v_cash := 0; v_bank := 0; v_bank_mode := '';
  end if;

  select * into v_cat from public.cash_category
   where id = (p->>'categoryId')::uuid and archived_at is null;
  if not found then raise exception 'choose a category'; end if;
  if v_cat.is_system then
    raise exception '"%" is filled in automatically and cannot be chosen', v_cat.name;
  end if;
  if v_cat.direction = 'in' then
    raise exception '"%" is a money-in category', v_cat.name;
  end if;
  if not public.is_leaf_category(v_cat.id) then
    raise exception '"%" is a category group — choose one of the categories inside it',
      v_cat.name;
  end if;

  if v_supplier is not null
     and not exists (select 1 from public.suppliers where id = v_supplier) then
    raise exception 'that supplier no longer exists';
  end if;

  -- ── Edit ─────────────────────────────────────────────────────────────────
  if v_id is not null then
    select * into v_old from public.expense where id = v_id for update;
    if not found or v_old.deleted_at is not null then
      raise exception 'expense not found';
    end if;
    -- Note 5: a paid expense has moved money. Cancel it and record a new one.
    if v_old.status <> 'pending' then
      raise exception 'a % expense cannot be edited', v_old.status;
    end if;
    -- Decision 5: the person who filed it, or anyone who can approve it. An
    -- approver fixing a mis-picked category should not have to bounce it back.
    if v_old.created_by is distinct from auth.uid()
       and not public.has_perm('expense.pay') then
      raise exception 'only the person who recorded this expense can change it';
    end if;

    -- A field-level diff, so the detail page can say what actually changed.
    if v_old.expense_date <> v_date then
      v_diff := v_diff || jsonb_build_object('expenseDate',
        jsonb_build_array(v_old.expense_date, v_date)); end if;
    if v_old.amount <> v_amount then
      v_diff := v_diff || jsonb_build_object('amount',
        jsonb_build_array(v_old.amount, v_amount)); end if;
    if v_old.category_id <> v_cat.id then
      v_diff := v_diff || jsonb_build_object('category',
        jsonb_build_array(
          (select name from public.cash_category where id = v_old.category_id),
          v_cat.name)); end if;
    if v_old.payment_mode <> v_mode then
      v_diff := v_diff || jsonb_build_object('paymentMode',
        jsonb_build_array(v_old.payment_mode, v_mode)); end if;
    if v_old.vendor_name <> btrim(coalesce(p->>'vendorName','')) then
      v_diff := v_diff || jsonb_build_object('vendorName',
        jsonb_build_array(v_old.vendor_name, btrim(coalesce(p->>'vendorName','')))); end if;
    if v_old.invoice_no <> btrim(coalesce(p->>'invoiceNo','')) then
      v_diff := v_diff || jsonb_build_object('invoiceNo',
        jsonb_build_array(v_old.invoice_no, btrim(coalesce(p->>'invoiceNo','')))); end if;
    if v_old.gst_amount <> v_gst then
      v_diff := v_diff || jsonb_build_object('gstAmount',
        jsonb_build_array(v_old.gst_amount, v_gst)); end if;
    if v_old.description <> btrim(coalesce(p->>'description','')) then
      v_diff := v_diff || jsonb_build_object('description',
        jsonb_build_array(v_old.description, btrim(coalesce(p->>'description','')))); end if;

    update public.expense set
      expense_date = v_date, category_id = v_cat.id,
      vendor_name = btrim(coalesce(p->>'vendorName','')),
      vendor_supplier_id = v_supplier,
      amount = v_amount, gst_included = v_gst_inc, gst_amount = v_gst,
      payment_mode = v_mode, split_cash = v_cash, split_bank = v_bank,
      split_bank_mode = v_bank_mode,
      invoice_no = btrim(coalesce(p->>'invoiceNo','')),
      description = btrim(coalesce(p->>'description','')),
      paid_by = v_paid_by, updated_by = auth.uid()
    where id = v_id;

    -- A save that changed nothing is not history worth recording.
    if v_diff <> '{}'::jsonb then
      perform public.log_expense_event(v_id, 'edited', v_diff);
      insert into public.activity_log (type, actor, item_name, total, notes)
        values ('expense', auth.uid(), v_cat.name, v_amount,
                'Edited expense #' || v_old.expense_no::text);
    end if;

    return v_id;
  end if;

  -- ── Create ───────────────────────────────────────────────────────────────
  insert into public.expense (
    expense_date, category_id, vendor_name, vendor_supplier_id,
    amount, gst_included, gst_amount,
    payment_mode, split_cash, split_bank, split_bank_mode,
    invoice_no, description, paid_by, status, created_by, updated_by)
  values (
    v_date, v_cat.id, btrim(coalesce(p->>'vendorName','')), v_supplier,
    v_amount, v_gst_inc, v_gst,
    v_mode, v_cash, v_bank, v_bank_mode,
    btrim(coalesce(p->>'invoiceNo','')), btrim(coalesce(p->>'description','')),
    v_paid_by, 'pending', auth.uid(), auth.uid())
  returning id into v_id;

  perform public.log_expense_event(v_id, 'created',
    jsonb_build_object('amount', v_amount, 'category', v_cat.name));

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('expense', auth.uid(), v_cat.name, v_amount,
            'Recorded expense of ' || v_amount::text || ' — ' || v_cat.name);

  -- Path one: whoever can pay records it paid in a single step. Path two leaves
  -- it pending for an approver.
  if v_pay then
    if not public.has_perm('expense.pay') then
      raise exception 'you can record this expense but not pay it — it needs approval';
    end if;
    perform public.pay_expense(v_id, v_date, v_mode, v_cash, v_bank, v_bank_mode);
  end if;

  return v_id;
end $$;

-- ─── pay_expense: approve and pay in one action ─────────────────────────────
-- The posting date is p_paid_on, NOT expense_date (note 3). The mode arguments
-- allow an approver to pay by a different method than was proposed.
create or replace function public.pay_expense(
  p_id uuid,
  p_paid_on date,
  p_mode text,
  p_split_cash numeric default 0,
  p_split_bank numeric default 0,
  p_split_bank_mode text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.expense; v_cat_name text;
  v_cash numeric := round(coalesce(p_split_cash, 0), 2);
  v_bank numeric := round(coalesce(p_split_bank, 0), 2);
  v_bank_mode text := coalesce(p_split_bank_mode, '');
  v_note text;
begin
  if not public.has_perm('expense.pay') then raise exception 'forbidden'; end if;

  select * into e from public.expense where id = p_id for update;
  if not found or e.deleted_at is not null then raise exception 'expense not found'; end if;
  if e.status <> 'pending' then
    raise exception 'this expense is already %', e.status;
  end if;
  if p_paid_on is null then raise exception 'when was it paid?'; end if;
  if p_paid_on > public.store_today() then
    raise exception 'a payment date cannot be in the future';
  end if;
  if p_mode not in ('Cash','UPI','Bank Transfer','Mixed') then
    raise exception 'choose a payment mode';
  end if;

  if p_mode = 'Mixed' then
    if v_cash <= 0 or v_bank <= 0 or round(v_cash + v_bank, 2) <> e.amount then
      raise exception 'the cash and bank amounts must add up to %', e.amount;
    end if;
    if v_bank_mode not in ('UPI','Bank Transfer') then
      raise exception 'say whether the bank half was UPI or a bank transfer';
    end if;
  else
    v_cash := 0; v_bank := 0; v_bank_mode := '';
  end if;

  -- Note 3: the day that matters is the day the cash moved.
  perform public.assert_cash_day_open(p_paid_on);

  select name into v_cat_name from public.cash_category where id = e.category_id;
  v_note := 'Expense #' || e.expense_no::text
            || case when e.vendor_name <> '' then ' — ' || e.vendor_name else '' end
            || case when e.invoice_no <> '' then ' (inv ' || e.invoice_no || ')' else '' end;

  update public.expense
     set status = 'paid', paid_on = p_paid_on, approved_by = auth.uid(),
         payment_mode = p_mode, split_cash = v_cash, split_bank = v_bank,
         split_bank_mode = v_bank_mode, updated_by = auth.uid()
   where id = p_id;

  -- Note 2: Mixed posts two rows, one per account, sharing this source_id.
  if p_mode = 'Mixed' then
    perform public.post_cash(p_paid_on, 'out', v_cash, 'Cash',
      e.category_id, 'expense', p_id, v_note || ' (cash part)', e.invoice_no, null, null);
    perform public.post_cash(p_paid_on, 'out', v_bank, v_bank_mode,
      e.category_id, 'expense', p_id, v_note || ' (bank part)', e.invoice_no, null, null);
  else
    perform public.post_cash(p_paid_on, 'out', e.amount, p_mode,
      e.category_id, 'expense', p_id, v_note, e.invoice_no, null, null);
  end if;

  perform public.log_expense_event(p_id, 'paid',
    jsonb_build_object('paidOn', p_paid_on, 'mode', p_mode, 'amount', e.amount));

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('expense', auth.uid(), coalesce(v_cat_name, ''), e.amount,
            'Paid expense #' || e.expense_no::text || ' by ' || p_mode
            || ' on ' || p_paid_on::text);
end $$;

-- ─── reject: a pending expense we are not paying. No money moved. ───────────
create or replace function public.reject_expense(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.expense; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.has_perm('expense.pay') then raise exception 'forbidden'; end if;
  if v_reason = '' then raise exception 'say why this expense is being rejected'; end if;

  select * into e from public.expense where id = p_id for update;
  if not found or e.deleted_at is not null then raise exception 'expense not found'; end if;
  if e.status <> 'pending' then
    raise exception 'only a pending expense can be rejected — this one is %', e.status;
  end if;

  update public.expense
     set status = 'rejected', reject_reason = v_reason,
         approved_by = auth.uid(), updated_by = auth.uid()
   where id = p_id;

  perform public.log_expense_event(p_id, 'rejected',
    jsonb_build_object('reason', v_reason));

  insert into public.activity_log (type, actor, total, notes)
    values ('expense', auth.uid(), e.amount,
            'Rejected expense #' || e.expense_no::text || ' — ' || v_reason);
end $$;

-- ─── cancel: a PAID expense that shouldn't have been. Reverses the cash. ────
create or replace function public.cancel_expense(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.expense; v_reason text := btrim(coalesce(p_reason, '')); v_n int;
begin
  if not public.has_perm('expense.cancel') then raise exception 'forbidden'; end if;
  if v_reason = '' then raise exception 'say why this expense is being cancelled'; end if;

  select * into e from public.expense where id = p_id for update;
  if not found or e.deleted_at is not null then raise exception 'expense not found'; end if;
  if e.status <> 'paid' then
    raise exception 'only a paid expense is cancelled — a pending one is rejected';
  end if;

  update public.expense
     set status = 'cancelled', cancel_reason = v_reason, updated_by = auth.uid()
   where id = p_id;

  -- Reverses BOTH legs of a Mixed payment. If the paid day is closed the
  -- reversals land on the current open day rather than rewriting it (0049).
  v_n := public.reverse_cash('expense', p_id, v_reason);

  perform public.log_expense_event(p_id, 'cancelled',
    jsonb_build_object('reason', v_reason, 'reversedEntries', v_n));

  insert into public.activity_log (type, actor, total, notes)
    values ('expense', auth.uid(), e.amount,
            'Cancelled expense #' || e.expense_no::text || ' — ' || v_reason);
end $$;

-- ─── delete: only a record that never moved money. Soft, per #32. ───────────
create or replace function public.delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.expense;
begin
  if not public.has_perm('expense.cancel') then raise exception 'forbidden'; end if;

  select * into e from public.expense where id = p_id for update;
  if not found or e.deleted_at is not null then raise exception 'expense not found'; end if;
  if e.status not in ('pending','rejected') then
    raise exception
      'a % expense is history — cancel it instead of removing it', e.status;
  end if;

  update public.expense
     set deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid()
   where id = p_id;

  perform public.log_expense_event(p_id, 'deleted', '{}'::jsonb);

  insert into public.activity_log (type, actor, total, notes)
    values ('expense', auth.uid(), e.amount,
            'Removed expense #' || e.expense_no::text);
end $$;

-- ─── Vendor autocomplete ────────────────────────────────────────────────────
-- Distinct past vendor names. Mitigates 'BESCOM' vs 'Bescom' drift without a
-- vendor master, which would be a second payables system (spec decision 11).
create or replace function public.expense_vendors()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct vendor_name
  from public.expense
  where deleted_at is null and btrim(vendor_name) <> ''
    and public.has_perm('expense.view')
  order by vendor_name
$$;

grant execute on function public.save_expense(jsonb) to authenticated;
grant execute on function public.pay_expense(uuid, date, text, numeric, numeric, text) to authenticated;
grant execute on function public.reject_expense(uuid, text) to authenticated;
grant execute on function public.cancel_expense(uuid, text) to authenticated;
grant execute on function public.delete_expense(uuid) to authenticated;
grant execute on function public.expense_vendors() to authenticated;
