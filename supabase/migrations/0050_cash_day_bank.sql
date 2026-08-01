-- ============================================================================
-- BT Store Management — bank closing on the day close
--
-- REVERSES DECISION 5 OF 0049 ("only cash is reconciled"). That decision rested
-- on there being no external source of truth for the bank. There is one: the
-- bank's own app or statement. Reading a balance off it is the bank's
-- equivalent of counting the drawer, so the day close now takes both.
--
-- What is NOT reversed:
--   * Decision 2 still holds — opening_bank/expected_bank are SNAPSHOTS taken
--     at close and never recomputed.
--   * Decision 3 still holds — opening_bank is the LEDGER's balance before the
--     day, never yesterday's typed closing. A variance stays visible.
--
-- New decisions:
--   6. THE BANK FIGURE IS OPTIONAL. A day closes with closing_bank null when
--      nobody could reach the bank. Null means "not checked", which is the
--      truth about that day, and is different from "checked and it was zero".
--      Rows closed before this migration are therefore null forever — they
--      were genuinely never bank-reconciled, and backfilling a computed figure
--      would fabricate a check that never happened.
--   7. THE BANK IS SQUARED BY A REAL ENTRY, NOT BY THE SNAPSHOT. adjust_bank_
--      balance posts an ordinary "Other → Adjustment" bank entry for the
--      difference. It is attributable, reversible and shows up in the cash
--      book like any other movement. The cash side has always demanded this be
--      done by hand; this only makes the same thing one click.
-- ============================================================================

-- ─── Bank balance helpers: mirrors of the cash pair in 0049 ─────────────────
create or replace function public.bank_opening_balance(p_date date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(round(sum(
    case when direction = 'in' then amount else -amount end), 2), 0)
  from public.cash_entry
  where account = 'bank' and deleted_at is null and on_date < p_date
$$;

create or replace function public.bank_day_movement(p_date date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(round(sum(
    case when direction = 'in' then amount else -amount end), 2), 0)
  from public.cash_entry
  where account = 'bank' and deleted_at is null and on_date = p_date
$$;

revoke execute on function public.bank_opening_balance(date) from public;
revoke execute on function public.bank_day_movement(date) from public;
grant execute on function public.bank_opening_balance(date) to authenticated;
grant execute on function public.bank_day_movement(date) to authenticated;

-- ─── Columns ────────────────────────────────────────────────────────────────
-- All nullable, per decision 6. No non-negative constraint on closing_bank: an
-- account can be overdrawn, and refusing to record that would be a lie.
alter table public.cash_day
  add column if not exists opening_bank  numeric(12,2),
  add column if not exists expected_bank numeric(12,2),
  add column if not exists closing_bank  numeric(12,2);

alter table public.cash_day
  add column if not exists bank_difference numeric(12,2)
    generated always as (closing_bank - expected_bank) stored;

-- ─── The snapshot stays immutable while closed ──────────────────────────────
create or replace function public.cash_day_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a closed day is history and is reopened, never deleted';
  end if;
  if old.status = 'closed'
     and (new.opening_cash <> old.opening_cash
          or new.expected_cash <> old.expected_cash
          or new.counted_cash <> old.counted_cash
          or new.opening_bank is distinct from old.opening_bank
          or new.expected_bank is distinct from old.expected_bank
          or new.closing_bank is distinct from old.closing_bank
          or new.closed_by is distinct from old.closed_by) then
    raise exception 'reopen % before changing what was counted',
      to_char(old.on_date, 'DD Mon YYYY');
  end if;
  return new;
end $$;

-- ─── Read surface ───────────────────────────────────────────────────────────
-- Dropped rather than replaced: the bank columns belong beside the cash ones,
-- and `create or replace view` can only append. Nothing depends on this view
-- but the client, so dropping it costs nothing. The grant below is re-issued
-- because dropping the view drops its privileges with it.
drop view if exists public.cash_day_v;
create view public.cash_day_v as
select d.on_date, d.opening_cash, d.expected_cash, d.counted_cash, d.difference,
       d.opening_bank, d.expected_bank, d.closing_bank, d.bank_difference,
       d.remarks, d.status,
       coalesce(cb.name, '') as closed_by_name, d.closed_at,
       coalesce(rb.name, '') as reopened_by_name, d.reopened_at, d.reopen_reason
from public.cash_day d
left join public.profiles cb on cb.id = d.closed_by
left join public.profiles rb on rb.id = d.reopened_by
where public.has_perm('cashbook.view');

grant select on public.cash_day_v to authenticated;

-- ─── Squaring the bank: decision 7 ──────────────────────────────────────────
-- Posts the difference as an ordinary manual entry so the ledger's bank balance
-- equals the figure read off the bank. Deliberately NOT part of close_cash_day:
-- closing records what was true, adjusting changes the ledger, and one call
-- that quietly did both would hide the second behind the first.
create or replace function public.adjust_bank_balance(
  p_on_date date, p_closing_bank numeric, p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_expected numeric; v_diff numeric; v_cat uuid; v_id uuid; v_note text;
begin
  if not public.has_perm('cashbook.entry') then raise exception 'forbidden'; end if;
  if p_on_date is null then raise exception 'which day is being adjusted?'; end if;
  if p_closing_bank is null then
    raise exception 'enter the balance the bank is showing';
  end if;

  -- Same lock the close takes, so an adjustment and a close cannot interleave
  -- and leave the snapshot describing a balance that no longer holds.
  perform pg_advisory_xact_lock(hashtext('cash_day:' || p_on_date::text));

  v_expected := round(public.bank_opening_balance(p_on_date)
                      + public.bank_day_movement(p_on_date), 2);
  v_diff     := round(round(p_closing_bank, 2) - v_expected, 2);

  if v_diff = 0 then
    raise exception 'the bank already matches the book — nothing to adjust';
  end if;

  select c.id into v_cat
  from public.cash_category c
  join public.cash_category p on p.id = c.parent_id
  where c.name = 'Adjustment' and p.name = 'Other' and c.archived_at is null;
  if v_cat is null then
    raise exception 'the "Other › Adjustment" category is missing';
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if v_note = '' then
    v_note := 'Bank balance adjusted to ' || round(p_closing_bank, 2)::text;
  end if;

  -- post_cash refuses a closed day, which is correct: square the bank BEFORE
  -- locking it, or reopen the day first.
  v_id := public.post_cash(
    p_on_date,
    case when v_diff > 0 then 'in' else 'out' end,
    abs(v_diff), 'Bank Transfer', v_cat, 'manual', null, v_note, '', null, null);

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('cashbook', auth.uid(), 'Adjustment', abs(v_diff),
            'Squared the bank for ' || to_char(p_on_date, 'DD Mon YYYY')
            || ' — book ' || v_expected::text
            || ', bank ' || round(p_closing_bank, 2)::text
            || ', posted ' || case when v_diff > 0 then 'in ' else 'out ' end
            || abs(v_diff)::text || ' — ' || v_note);

  return v_id;
end $$;

grant execute on function public.adjust_bank_balance(date, numeric, text) to authenticated;

-- ─── close_cash_day now takes the bank figure ───────────────────────────────
-- Dropped rather than replaced: appending a defaulted parameter would leave two
-- overloads, and a three-argument named call could resolve to either.
drop function if exists public.close_cash_day(date, numeric, text);

create or replace function public.close_cash_day(
  p_date date,
  p_counted_cash numeric,
  p_remarks text default '',
  p_closing_bank numeric default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_opening numeric; v_expected numeric; v_counted numeric;
        v_open_bank numeric; v_exp_bank numeric; v_close_bank numeric;
        v_bank_diff numeric; v_existing text; v_diff numeric;
begin
  if not public.has_perm('cashbook.close') then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'which day are you closing?'; end if;
  if p_date > public.store_today() then
    raise exception 'a day cannot be closed before it has happened';
  end if;

  v_counted := round(coalesce(p_counted_cash, 0), 2);
  if v_counted < 0 then raise exception 'the counted cash cannot be negative'; end if;

  -- Null stays null all the way through: decision 6.
  v_close_bank := case when p_closing_bank is null
                       then null else round(p_closing_bank, 2) end;

  -- One close at a time: two operators counting the same drawer must not both
  -- write a figure. Taken BEFORE the totals are computed so the numbers cannot
  -- shift underneath the winner.
  perform pg_advisory_xact_lock(hashtext('cash_day:' || p_date::text));

  select status into v_existing from public.cash_day where on_date = p_date;
  if v_existing = 'closed' then
    raise exception '% is already closed', to_char(p_date, 'DD Mon YYYY');
  end if;

  v_opening  := public.cash_opening_balance(p_date);
  v_expected := round(v_opening + public.cash_day_movement(p_date), 2);
  v_diff     := round(v_counted - v_expected, 2);

  -- The bank snapshot is taken whether or not a figure was read off the bank,
  -- so a day closed without one still records what the book said at the time.
  v_open_bank := public.bank_opening_balance(p_date);
  v_exp_bank  := round(v_open_bank + public.bank_day_movement(p_date), 2);
  v_bank_diff := case when v_close_bank is null
                      then null else round(v_close_bank - v_exp_bank, 2) end;

  insert into public.cash_day (
    on_date, opening_cash, expected_cash, counted_cash,
    opening_bank, expected_bank, closing_bank, remarks,
    status, closed_by, closed_at)
  values (
    p_date, v_opening, v_expected, v_counted,
    v_open_bank, v_exp_bank, v_close_bank, btrim(coalesce(p_remarks, '')),
    'closed', auth.uid(), now())
  on conflict (on_date) do update
    set opening_cash  = excluded.opening_cash,
        expected_cash = excluded.expected_cash,
        counted_cash  = excluded.counted_cash,
        opening_bank  = excluded.opening_bank,
        expected_bank = excluded.expected_bank,
        closing_bank  = excluded.closing_bank,
        remarks       = excluded.remarks,
        status        = 'closed',
        closed_by     = excluded.closed_by,
        closed_at     = excluded.closed_at;

  insert into public.activity_log (type, actor, total, notes)
    values ('cashbook', auth.uid(), v_counted,
            'Closed ' || to_char(p_date, 'DD Mon YYYY')
            || ' — expected ' || v_expected::text
            || ', counted ' || v_counted::text
            || case
                 when v_diff = 0 then ', tallied'
                 when v_diff < 0 then ', short ' || abs(v_diff)::text
                 else ', excess ' || v_diff::text
               end
            || case
                 when v_close_bank is null then '; bank not checked'
                 else '; bank book ' || v_exp_bank::text
                      || ', statement ' || v_close_bank::text
                      || case
                           when v_bank_diff = 0 then ', tallied'
                           when v_bank_diff < 0 then ', short ' || abs(v_bank_diff)::text
                           else ', excess ' || v_bank_diff::text
                         end
               end
            || case when btrim(coalesce(p_remarks,'')) <> ''
                    then ' — ' || btrim(p_remarks) else '' end);
end $$;

grant execute on function public.close_cash_day(date, numeric, text, numeric) to authenticated;

-- ─── One day's reconciliation figures, now both sides ───────────────────────
create or replace function public.cash_day_summary(p_on_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_day date := coalesce(p_on_date, public.store_today());
        d public.cash_day; v_opening numeric; v_expected numeric;
        v_in numeric; v_out numeric;
        v_open_bank numeric; v_exp_bank numeric;
        v_bank_in numeric; v_bank_out numeric;
begin
  if not public.has_perm('cashbook.view') then raise exception 'forbidden'; end if;

  select * into d from public.cash_day where on_date = v_day;

  if d.on_date is not null and d.status = 'closed' then
    v_opening  := d.opening_cash;
    v_expected := d.expected_cash;
    -- Days closed before 0050 have no bank snapshot. Falling back to the live
    -- figures shows the book's position rather than an empty row; there is no
    -- snapshot to contradict, because none was ever taken.
    v_open_bank := coalesce(d.opening_bank, public.bank_opening_balance(v_day));
    v_exp_bank  := coalesce(d.expected_bank,
                     round(public.bank_opening_balance(v_day)
                           + public.bank_day_movement(v_day), 2));
  else
    v_opening   := public.cash_opening_balance(v_day);
    v_expected  := round(v_opening + public.cash_day_movement(v_day), 2);
    v_open_bank := public.bank_opening_balance(v_day);
    v_exp_bank  := round(v_open_bank + public.bank_day_movement(v_day), 2);
  end if;

  select coalesce(sum(case when account = 'cash' and direction = 'in'  then amount end), 0),
         coalesce(sum(case when account = 'cash' and direction = 'out' then amount end), 0),
         coalesce(sum(case when account = 'bank' and direction = 'in'  then amount end), 0),
         coalesce(sum(case when account = 'bank' and direction = 'out' then amount end), 0)
    into v_in, v_out, v_bank_in, v_bank_out
  from public.cash_entry
  where deleted_at is null and on_date = v_day;

  return jsonb_build_object(
    'onDate',       v_day,
    'openingCash',  v_opening,
    'expectedCash', v_expected,
    'cashIn',       v_in,
    'cashOut',      v_out,
    -- Null means never counted, which is different from counted zero.
    'countedCash',  case when d.on_date is null then null else d.counted_cash end,
    'openingBank',  v_open_bank,
    'expectedBank', v_exp_bank,
    'bankIn',       v_bank_in,
    'bankOut',      v_bank_out,
    -- Null means the bank was never checked. Decision 6.
    'closingBank',  d.closing_bank,
    'status',       coalesce(d.status, 'open')
  );
end $$;

grant execute on function public.cash_day_summary(date) to authenticated;
