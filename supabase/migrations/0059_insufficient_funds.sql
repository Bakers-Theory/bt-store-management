-- ============================================================================
-- BT Store Management — you cannot spend money you do not have
--
--   1. THE LEDGER IS THE ONLY TRUTH. There is no stored balance column (0045),
--      so "how much cash is there" is a sum over cash_entry — the same sum
--      cashbook_summary() shows on the tiles. Anything else could disagree with
--      what the operator is looking at.
--   2. POINT-IN-TIME, NOT AS-OF-THE-DATE. The guard compares against the live
--      balance, exactly like the "Cash in hand" tile. A backdated entry still
--      has to be payable out of what is in the drawer now — the alternative is
--      an as-of balance that passes here and leaves the drawer negative today.
--   3. ONLY MONEY OUT, AND ONLY THE HAND-DRIVEN PATHS. Manual entries,
--      transfers and expense payments are what an operator chooses to spend.
--      Bills, salary, advances and supplier payments record something that
--      already happened elsewhere and are deliberately left alone.
--   4. AN EDIT COMPARES AGAINST THE BALANCE WITHOUT ITSELF. Raising a ₹100
--      entry to ₹150 needs ₹50 more, not ₹150 more, so the row being edited is
--      excluded from the balance before the comparison.
-- ============================================================================

create or replace function public.account_balance(
  p_account text,
  p_exclude_entry_id uuid default null
)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
    from public.cash_entry
   where deleted_at is null
     and account = p_account
     and (p_exclude_entry_id is null or id <> p_exclude_entry_id)
$$;

-- Raises with the shortfall spelled out, because "insufficient funds" leaves
-- the operator to go and work out how short they are.
create or replace function public.assert_funds(
  p_account text,
  p_amount  numeric,
  p_exclude_entry_id uuid default null
)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_bal numeric;
begin
  if round(coalesce(p_amount, 0), 2) <= 0 then return; end if;

  v_bal := public.account_balance(p_account, p_exclude_entry_id);
  if v_bal < round(p_amount, 2) then
    raise exception 'not enough % — % available, this needs % (short by %)',
      case p_account when 'cash' then 'cash in hand' else 'money in the bank' end,
      round(v_bal, 2), round(p_amount, 2), round(round(p_amount, 2) - v_bal, 2);
  end if;
end $$;

revoke execute on function public.assert_funds(text, numeric, uuid) from public;
grant execute on function public.account_balance(text, uuid) to authenticated;

-- ─── The guarded paths ──────────────────────────────────────────────────────
-- Each function below is unchanged apart from its assert_funds call; they are
-- restated in full because plpgsql has no way to patch a body.

create or replace function public.add_cash_entry(
  p_on_date     date,
  p_direction   text,
  p_amount      numeric,
  p_mode        text,
  p_category_id uuid,
  p_note        text,
  p_reference_no text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cat public.cash_category;
begin
  if not public.has_perm('cashbook.entry') then raise exception 'forbidden'; end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'say what this entry is for';
  end if;

  select * into v_cat from public.cash_category
   where id = p_category_id and archived_at is null;
  if not found then raise exception 'choose a category'; end if;
  -- A category declares which way money moves through it, so a mismatch is a
  -- mistake worth catching rather than filing.
  if v_cat.direction <> 'both' and v_cat.direction <> p_direction then
    raise exception '"%" is a % category', v_cat.name,
      case v_cat.direction when 'in' then 'money-in' else 'money-out' end;
  end if;
  if v_cat.is_system then
    raise exception '"%" is filled in automatically and cannot be chosen by hand',
      v_cat.name;
  end if;

  if p_direction = 'out' then
    perform public.assert_funds(public.mode_to_account(p_mode), p_amount);
  end if;

  v_id := public.post_cash(
    p_on_date, p_direction, p_amount, p_mode, p_category_id,
    'manual', null, p_note, p_reference_no, null, null);

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('cashbook', auth.uid(), v_cat.name, round(p_amount, 2),
            'Recorded ' || p_direction || ' ' || round(p_amount, 2)::text
            || ' by ' || p_mode || ' on ' || p_on_date::text
            || ' — ' || btrim(p_note));

  return v_id;
end $$;

create or replace function public.update_cash_entry(
  p_id          uuid,
  p_on_date     date,
  p_amount      numeric,
  p_mode        text,
  p_category_id uuid,
  p_note        text,
  p_reference_no text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare e public.cash_entry; v_cat public.cash_category; v_account text;
begin
  if not public.has_perm('cashbook.entry') then raise exception 'forbidden'; end if;

  select * into e from public.cash_entry where id = p_id for update;
  if not found or e.deleted_at is not null then raise exception 'entry not found'; end if;
  -- The trigger in 0045 would also refuse this; raising here is what makes the
  -- message readable instead of a trigger name.
  if e.source_type <> 'manual' then
    raise exception 'this entry came from a % and is changed there, not here', e.source_type;
  end if;
  if e.created_by is distinct from auth.uid() then
    raise exception 'only the person who recorded an entry can change it';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'say what this entry is for';
  end if;
  if p_on_date > public.store_today() then
    raise exception 'a cash book date cannot be in the future';
  end if;
  if round(coalesce(p_amount, 0), 2) <= 0 then
    raise exception 'an amount must be more than zero';
  end if;

  -- Both the day it is moving OFF and the day it is moving ON must be open.
  perform public.assert_cash_day_open(e.on_date);
  perform public.assert_cash_day_open(p_on_date);

  select * into v_cat from public.cash_category
   where id = p_category_id and archived_at is null;
  if not found then raise exception 'choose a category'; end if;
  if v_cat.is_system then
    raise exception '"%" is filled in automatically and cannot be chosen by hand',
      v_cat.name;
  end if;
  if v_cat.direction <> 'both' and v_cat.direction <> e.direction then
    raise exception '"%" is a % category', v_cat.name,
      case v_cat.direction when 'in' then 'money-in' else 'money-out' end;
  end if;
  if not public.is_leaf_category(p_category_id) then
    raise exception '"%" is a category group — choose one of the categories inside it',
      v_cat.name;
  end if;

  v_account := public.mode_to_account(p_mode);
  if v_account is null then raise exception 'unknown payment mode "%"', p_mode; end if;

  -- Note 4: this row's own effect comes out of the balance first, so an edit is
  -- measured by what it ADDS to the spend, not by its whole amount. The account
  -- may also be changing (Cash → UPI), and the exclusion covers that too.
  if e.direction = 'out' then
    perform public.assert_funds(v_account, p_amount, p_id);
  end if;

  -- direction is NOT editable: flipping it turns an expense into income while
  -- keeping the same audit row. Delete and re-record instead.
  update public.cash_entry
     set on_date = p_on_date, amount = round(p_amount, 2), payment_mode = p_mode,
         account = v_account, category_id = p_category_id,
         note = btrim(p_note), reference_no = btrim(coalesce(p_reference_no, ''))
   where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('cashbook', auth.uid(), v_cat.name, round(p_amount, 2),
            'Edited a cash book entry dated ' || p_on_date::text
            || ' — ' || btrim(p_note));
end $$;

create or replace function public.transfer_cash(
  p_on_date      date,
  p_from_account text,
  p_amount       numeric,
  p_note         text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid := gen_random_uuid(); v_cat uuid;
        v_out_mode text; v_in_mode text; v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.has_perm('cashbook.entry') then raise exception 'forbidden'; end if;
  if p_from_account not in ('cash','bank') then
    raise exception 'a transfer moves money between cash and bank';
  end if;
  if v_note = '' then raise exception 'say what this transfer is for'; end if;

  -- Only the sending side is checked. The receiving leg can only ever raise the
  -- other account.
  perform public.assert_funds(p_from_account, p_amount);

  v_cat := public.system_category('Transfer');

  -- The mode is what carries each leg into its own account: post_cash derives
  -- the account from the mode, so the pair must name opposite modes.
  if p_from_account = 'cash' then
    v_out_mode := 'Cash';          -- out of the drawer
    v_in_mode  := 'Bank Transfer'; -- into the bank
  else
    v_out_mode := 'Bank Transfer'; -- out of the bank
    v_in_mode  := 'Cash';          -- into the drawer
  end if;

  perform public.post_cash(p_on_date, 'out', p_amount, v_out_mode, v_cat,
    'transfer', null, v_note, '', null, v_tid);
  perform public.post_cash(p_on_date, 'in', p_amount, v_in_mode, v_cat,
    'transfer', null, v_note, '', null, v_tid);

  insert into public.activity_log (type, actor, total, notes)
    values ('cashbook', auth.uid(), round(p_amount, 2),
            'Moved ' || round(p_amount, 2)::text || ' from ' || p_from_account
            || ' on ' || p_on_date::text || ' — ' || v_note);

  return v_tid;
end $$;

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

  -- Both halves of a Mixed payment are checked before either is posted, so a
  -- payment that only half fits is refused whole rather than half-landing.
  if p_mode = 'Mixed' then
    perform public.assert_funds('cash', v_cash);
    perform public.assert_funds('bank', v_bank);
  else
    perform public.assert_funds(public.mode_to_account(p_mode), e.amount);
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

grant execute on function public.add_cash_entry(date, text, numeric, text, uuid, text, text) to authenticated;
grant execute on function public.update_cash_entry(uuid, date, numeric, text, uuid, text, text) to authenticated;
grant execute on function public.transfer_cash(date, text, numeric, text) to authenticated;
grant execute on function public.pay_expense(uuid, date, text, numeric, numeric, text) to authenticated;
