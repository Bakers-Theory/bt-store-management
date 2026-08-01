-- ============================================================================
-- BT Store Management — daily cash reconciliation (Phase B)
--
--   1. NO ROW MEANS OPEN. A cash_day row only exists once a day has been
--      closed. Every historical day the 0046 backfill created is therefore open
--      and unreconciled — which is the truth about it.
--   2. THE SNAPSHOT IS THE POINT. opening_cash and expected_cash are stored at
--      close, never recomputed. A reversal posted upstream next week must not
--      change what the drawer held on the night someone counted it.
--   3. opening_cash IS THE LEDGER'S BALANCE BEFORE THE DAY, NOT YESTERDAY'S
--      COUNT. If yesterday was 50 short, that is a recorded variance. Carrying
--      the counted figure forward would fold an unexplained loss into today's
--      expectation and hide it — the exact failure reconciliation exists to
--      catch. Squaring the ledger with reality is a deliberate, attributable
--      "Other → Adjustment" entry.
--   4. THE LOCK IS ENFORCED TWICE. assert_cash_day_open (called by every
--      posting RPC since 0047) refuses new postings; the trigger on cash_entry
--      refuses edits to existing ones. Neither depends on the other.
--   5. ONLY CASH IS RECONCILED. There is no physical count to check the bank
--      against, so cash_day has no bank columns.
-- ============================================================================

create table if not exists public.cash_day (
  on_date       date primary key,
  opening_cash  numeric(12,2) not null,
  expected_cash numeric(12,2) not null,
  counted_cash  numeric(12,2) not null,
  difference    numeric(12,2) generated always as (counted_cash - expected_cash) stored,
  remarks       text not null default '',
  -- Defaults to 'closed' because a row only ever comes into existence through
  -- close_cash_day. 'open' is reached only by reopen_cash_day.
  status        text not null default 'closed'
                  check (status in ('open','closed')),
  closed_by     uuid references public.profiles(id) on delete set null,
  closed_at     timestamptz,
  reopened_by   uuid references public.profiles(id) on delete set null,
  reopened_at   timestamptz,
  reopen_reason text not null default '',

  constraint cash_day_counted_non_negative check (counted_cash >= 0),
  constraint cash_day_reopen_needs_reason
    check (reopened_at is null or btrim(reopen_reason) <> '')
);

create index if not exists cash_day_status_idx on public.cash_day (status, on_date desc);
create index if not exists cash_day_variance_idx
  on public.cash_day (on_date desc) where difference <> 0;

alter table public.cash_day enable row level security;
drop policy if exists cash_day_read on public.cash_day;
create policy cash_day_read on public.cash_day for select
  using (public.has_perm('cashbook.view'));

-- ─── Balance helpers ────────────────────────────────────────────────────────
-- The ledger's cash balance STRICTLY BEFORE p_date. Decision 3 above.
create or replace function public.cash_opening_balance(p_date date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(round(sum(
    case when direction = 'in' then amount else -amount end), 2), 0)
  from public.cash_entry
  where account = 'cash' and deleted_at is null and on_date < p_date
$$;

-- The day's own net cash movement.
create or replace function public.cash_day_movement(p_date date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(round(sum(
    case when direction = 'in' then amount else -amount end), 2), 0)
  from public.cash_entry
  where account = 'cash' and deleted_at is null and on_date = p_date
$$;

revoke execute on function public.cash_opening_balance(date) from public;
revoke execute on function public.cash_day_movement(date) from public;
grant execute on function public.cash_opening_balance(date) to authenticated;
grant execute on function public.cash_day_movement(date) to authenticated;

-- ─── Read surface ───────────────────────────────────────────────────────────
create or replace view public.cash_day_v as
select d.on_date, d.opening_cash, d.expected_cash, d.counted_cash, d.difference,
       d.remarks, d.status,
       coalesce(cb.name, '') as closed_by_name, d.closed_at,
       coalesce(rb.name, '') as reopened_by_name, d.reopened_at, d.reopen_reason
from public.cash_day d
left join public.profiles cb on cb.id = d.closed_by
left join public.profiles rb on rb.id = d.reopened_by
where public.has_perm('cashbook.view');

grant select on public.cash_day_v to authenticated;

-- ─── The lock, part 1: no new postings to a closed day ──────────────────────
-- Replaces the 0045 stub. Every posting RPC has called this since 0047, so
-- filling in the body arms the lock everywhere at once, with no call site
-- touched.
create or replace function public.assert_cash_day_open(p_date date)
returns void language plpgsql stable set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.cash_day where on_date = p_date;
  -- No row at all means the day is open. Decision 1.
  if v_status = 'closed' then
    raise exception 'the cash book for % is closed — ask an admin to reopen it',
      to_char(p_date, 'DD Mon YYYY');
  end if;
end $$;

-- Where a reversal lands. Replaces the 0045 stub.
create or replace function public.reversal_date(p_orig_date date)
returns date language plpgsql stable set search_path = public as $$
declare v_today date := public.store_today();
begin
  -- The original day if it is still open: the correction belongs with the event.
  if not exists (select 1 from public.cash_day
                  where on_date = p_orig_date and status = 'closed') then
    return p_orig_date;
  end if;

  -- Otherwise today, so a counted day is never rewritten. If today is closed too
  -- there is no open day to post into, and decision 5 of the spec admits no
  -- exception — say so rather than invent a date.
  if exists (select 1 from public.cash_day
              where on_date = v_today and status = 'closed') then
    raise exception
      'the cash book for today is closed — reopen it to record this correction';
  end if;

  return v_today;
end $$;

-- ─── The lock, part 2: no edits to entries on a closed day ──────────────────
create or replace function public.cash_entry_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a cash book entry is never deleted — it is removed with a reason';
  end if;

  -- ADDED IN 0049: a counted day is frozen, whatever the row's source_type.
  -- Checked FIRST so the message names the real obstacle.
  if exists (select 1 from public.cash_day
              where on_date = old.on_date and status = 'closed') then
    raise exception 'the cash book for % is closed — ask an admin to reopen it',
      to_char(old.on_date, 'DD Mon YYYY');
  end if;

  if old.source_type <> 'manual' then
    raise exception
      'this entry came from a % and cannot be edited here — change the % itself',
      old.source_type, old.source_type;
  end if;

  if exists (select 1 from public.cash_entry r
              where r.reverses_id = old.id and r.deleted_at is null)
     and (new.amount <> old.amount
          or new.account <> old.account
          or new.direction <> old.direction
          or new.on_date <> old.on_date
          or new.source_type <> old.source_type) then
    raise exception 'this entry has already been reversed and cannot be changed';
  end if;

  return new;
end $$;

-- ─── cash_day immutability ──────────────────────────────────────────────────
-- The snapshot columns are set once per close. They are editable again only
-- while the day is reopened, so a reopened day can be counted a second time
-- (decision 4).
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
          or new.closed_by is distinct from old.closed_by) then
    raise exception 'reopen % before changing what was counted',
      to_char(old.on_date, 'DD Mon YYYY');
  end if;
  return new;
end $$;

drop trigger if exists cash_day_immutable on public.cash_day;
create trigger cash_day_immutable
  before update or delete on public.cash_day
  for each row execute function public.cash_day_guard();

create or replace function public.close_cash_day(
  p_date date, p_counted_cash numeric, p_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_opening numeric; v_expected numeric; v_counted numeric;
        v_existing text; v_diff numeric;
begin
  if not public.has_perm('cashbook.close') then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'which day are you closing?'; end if;
  if p_date > public.store_today() then
    raise exception 'a day cannot be closed before it has happened';
  end if;

  v_counted := round(coalesce(p_counted_cash, 0), 2);
  if v_counted < 0 then raise exception 'the counted cash cannot be negative'; end if;

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

  insert into public.cash_day (
    on_date, opening_cash, expected_cash, counted_cash, remarks,
    status, closed_by, closed_at)
  values (
    p_date, v_opening, v_expected, v_counted, btrim(coalesce(p_remarks, '')),
    'closed', auth.uid(), now())
  on conflict (on_date) do update
    set opening_cash  = excluded.opening_cash,
        expected_cash = excluded.expected_cash,
        counted_cash  = excluded.counted_cash,
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
            || case when btrim(coalesce(p_remarks,'')) <> ''
                    then ' — ' || btrim(p_remarks) else '' end);
end $$;

create or replace function public.reopen_cash_day(p_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_reason text := btrim(coalesce(p_reason, '')); v_status text;
begin
  if not public.has_perm('cashbook.reopen') then raise exception 'forbidden'; end if;
  if v_reason = '' then
    raise exception 'say why this day is being reopened';
  end if;

  select status into v_status from public.cash_day where on_date = p_date;
  if v_status is null then
    raise exception '% was never closed', to_char(p_date, 'DD Mon YYYY');
  end if;
  if v_status = 'open' then
    raise exception '% is already open', to_char(p_date, 'DD Mon YYYY');
  end if;

  -- The close figures are KEPT. A reopened day still records what was counted
  -- and by whom; that is the audit trail the reopen is answerable to.
  update public.cash_day
     set status = 'open', reopened_by = auth.uid(), reopened_at = now(),
         reopen_reason = v_reason
   where on_date = p_date;

  insert into public.activity_log (type, actor, notes)
    values ('cashbook', auth.uid(),
            'Reopened ' || to_char(p_date, 'DD Mon YYYY') || ' — ' || v_reason);
end $$;

grant execute on function public.close_cash_day(date, numeric, text) to authenticated;
grant execute on function public.reopen_cash_day(date, text) to authenticated;

-- ─── Reconciliation figures for one day ─────────────────────────────────────
-- Deliberately separate from cashbook_summary(from, to), which summarises a
-- user-chosen date RANGE and has no single day to reconcile against.
--
-- A closed day reports its SNAPSHOT; an open day is computed live. That is the
-- whole reason the snapshot exists (decision 2 in the header).
create or replace function public.cash_day_summary(p_on_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_day date := coalesce(p_on_date, public.store_today());
        d public.cash_day; v_opening numeric; v_expected numeric;
        v_in numeric; v_out numeric;
begin
  if not public.has_perm('cashbook.view') then raise exception 'forbidden'; end if;

  select * into d from public.cash_day where on_date = v_day;

  if d.on_date is not null and d.status = 'closed' then
    v_opening  := d.opening_cash;
    v_expected := d.expected_cash;
  else
    v_opening  := public.cash_opening_balance(v_day);
    v_expected := round(v_opening + public.cash_day_movement(v_day), 2);
  end if;

  select coalesce(sum(case when direction = 'in'  then amount end), 0),
         coalesce(sum(case when direction = 'out' then amount end), 0)
    into v_in, v_out
  from public.cash_entry
  where deleted_at is null and account = 'cash' and on_date = v_day;

  return jsonb_build_object(
    'onDate',       v_day,
    'openingCash',  v_opening,
    'expectedCash', v_expected,
    'cashIn',       v_in,
    'cashOut',      v_out,
    -- Null means never counted, which is different from counted zero.
    'countedCash',  case when d.on_date is null then null else d.counted_cash end,
    'status',       coalesce(d.status, 'open')
  );
end $$;

grant execute on function public.cash_day_summary(date) to authenticated;
