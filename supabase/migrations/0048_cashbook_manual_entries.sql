-- ============================================================================
-- BT Store Management — manual cashbook entries and cash↔bank transfers
--
--   1. A MANUAL ENTRY MUST STATE ITS PURPOSE. Enforced by a CHECK on the table
--      (0045) as well as here, because that note is the entire reason the
--      feature exists: money left the drawer and someone must say why.
--   2. ONLY YOUR OWN, AND ONLY WHILE THE DAY IS OPEN. Editing someone else's
--      entry is not a correction, it is a rewrite of their record. Once phase B
--      can close a day, editing anything on it stops.
--   3. DELETION IS SOFT. #32's rule. The row stays, excluded from every view
--      and every balance.
--   4. A TRANSFER IS TWO LEGS, ONE TRANSACTION. Both rows share a transfer_id,
--      so a half-transfer cannot exist and the pair can always be shown
--      together.
-- ============================================================================

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

create or replace function public.delete_cash_entry(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.cash_entry; v_name text;
begin
  if not public.has_perm('cashbook.entry') then raise exception 'forbidden'; end if;

  select * into e from public.cash_entry where id = p_id for update;
  if not found or e.deleted_at is not null then raise exception 'entry not found'; end if;
  if e.source_type <> 'manual' then
    raise exception 'this entry came from a % and is removed there, not here', e.source_type;
  end if;
  if e.created_by is distinct from auth.uid() then
    raise exception 'only the person who recorded an entry can remove it';
  end if;
  perform public.assert_cash_day_open(e.on_date);

  select name into v_name from public.cash_category where id = e.category_id;

  -- Soft, per #32. The row stays; every view and balance filters it out.
  update public.cash_entry
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('cashbook', auth.uid(), coalesce(v_name, ''), e.amount,
            'Removed a cash book entry dated ' || e.on_date::text
            || ' — ' || e.note);
end $$;

-- ─── Transfers ──────────────────────────────────────────────────────────────
-- Both legs, one transaction, one transfer_id. `from_account` decides the pair:
-- cash→bank is the daily deposit; bank→cash is a withdrawal for the drawer.
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

grant execute on function public.add_cash_entry(date, text, numeric, text, uuid, text, text) to authenticated;
grant execute on function public.update_cash_entry(uuid, date, numeric, text, uuid, text, text) to authenticated;
grant execute on function public.delete_cash_entry(uuid) to authenticated;
grant execute on function public.transfer_cash(date, text, numeric, text) to authenticated;
