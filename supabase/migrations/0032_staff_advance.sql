-- ============================================================================
-- BT Store Management — staff advances (Phase 3 of the HR module)
--
-- An advance is money handed to an employee against a future salary. The model,
-- decided with the owner:
--
--   1. RECOVERY IS DECIDED AT PAYROLL TIME, not scheduled. An advance carries no
--      installment amount. Whoever runs payroll enters how much to recover this
--      month, pre-filled with min(balance, net).
--   2. THE BALANCE IS NEVER STORED. balance = sum(approved advances) −
--      sum(recoveries). Computed, so deleting a payroll record restores the
--      balance with no reversal code, and there is no column to drift.
--   3. RECOVERY IS A SEPARATE TERM. salary_payment.net keeps its exact meaning
--      (salary net of leave); net_payable = net − advance_recovery is the new
--      bottom line. Folding recovery into `deduction` would break
--      payroll_compute's invariant that the deduction comes only from unpaid
--      days, and would make a recovery indistinguishable from leave on every
--      existing report.
--   4. A RECOVERY COUNTS AS SOON AS THE PAYROLL RECORD EXISTS, paid or not. If
--      only paid records counted, a prepared-but-unpaid July recovery would
--      leave the balance showing the full amount, so August would suggest
--      recovering it again — and once both were paid the employee would have
--      been charged twice.
--
-- Permissions: `advance.view`, `advance.request`, `advance.approve` — all
-- grantable, none in any preset, so advances are Owner-only until deliberately
-- delegated (the same treatment as salary.* and staff.manage). Recovery at
-- payroll time rides on the existing `salary.edit`.
--
-- The Owner is excluded throughout, exactly as in attendance and salary.
--
-- THIS FILE IS PURELY ADDITIVE. The two changes to existing RPCs are in 0033,
-- so the risky part can be reviewed and rolled back separately.
-- ============================================================================

-- ─── Audit log: advance entry types ─────────────────────────────────────────
-- Widen only, and idempotently — same reasoning and shape as 0029 and 0030.
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and conname = 'activity_log_type_check';

  if v_def is null or v_def not like '%advance_pay%' then
    alter table public.activity_log drop constraint if exists activity_log_type_check;
    alter table public.activity_log add constraint activity_log_type_check
      check (type in ('in','out','bill','cancel','delete','open','close',
                      'settings','staff_add','staff_edit','staff_remove','password',
                      'attendance','salary','salary_pay','advance','advance_pay'));
  end if;
end $ck$;

-- ─── salary_payment: the recovery term ──────────────────────────────────────
-- Additive. `advance_recovery` defaults to 0, so net_payable = net for all
-- history and there is nothing to migrate.
alter table public.salary_payment
  add column if not exists advance_recovery numeric(12,2) not null default 0,
  add column if not exists net_payable numeric(12,2);

-- Backfill net_payable for existing rows. (Neither constraint below references
-- net_payable, so this is for correctness of the data rather than to keep the
-- table valid mid-migration.)
update public.salary_payment set net_payable = net where net_payable is null;

do $c1$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.salary_payment'::regclass
      and conname = 'advance_recovery_non_negative'
  ) then
    alter table public.salary_payment add constraint advance_recovery_non_negative
      check (advance_recovery >= 0);
  end if;
end $c1$;

-- Net pay can reach zero but never go negative — the same shape as
-- payroll_compute's least(p_gross, ...) cap on the leave deduction.
do $c2$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.salary_payment'::regclass
      and conname = 'recovery_within_net'
  ) then
    alter table public.salary_payment add constraint recovery_within_net
      check (advance_recovery <= net);
  end if;
end $c2$;

-- ─── The advance ledger ─────────────────────────────────────────────────────
create table if not exists public.staff_advance (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  amount        numeric(12,2) not null check (amount > 0),
  -- Optional: recording an advance should not be obstructed by a mandatory
  -- free-text field. A REJECTION, by contrast, must be explicable — below.
  note          text not null default '',
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  requested_on  date not null,
  requested_by  uuid references public.profiles(id) on delete set null,
  -- Set together on approval: approval and disbursement are one step, so an
  -- approved advance is money that has left the till.
  approved_on   date,
  payment_mode  text not null default ''
                  check (payment_mode in ('', 'Cash', 'UPI', 'Bank Transfer', 'Cheque')),
  decided_by    uuid references public.profiles(id) on delete set null,
  reject_reason text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Money handed over must say when and how.
  constraint approved_needs_date_and_mode
    check (status <> 'approved' or (approved_on is not null and payment_mode <> '')),
  -- A refusal must be explicable.
  constraint rejected_needs_reason
    check (status <> 'rejected' or btrim(reject_reason) <> '')
);

create index if not exists staff_advance_profile_idx
  on public.staff_advance (profile_id, status);
create index if not exists staff_advance_requested_idx
  on public.staff_advance (requested_on desc);

drop trigger if exists staff_advance_updated_at on public.staff_advance;
create trigger staff_advance_updated_at before update on public.staff_advance
  for each row execute function public.set_updated_at();

-- ─── RLS: reads need advance.view; writes only through the RPCs below ───────
alter table public.staff_advance enable row level security;
drop policy if exists staff_advance_read on public.staff_advance;
create policy staff_advance_read on public.staff_advance for select
  using (public.has_perm('advance.view'));

-- ─── Internal: one definition of "balance", with NO permission gate ─────────
-- The balance is deliberately NOT read from staff_advance_balance_v below.
-- That view is gated on `advance.view`, but set_advance_recovery runs on
-- `salary.edit` and payroll_preview on `salary.view`. A payroll operator
-- without `advance.view` would read zero rows from the view and silently get a
-- zero balance — a wrong money figure with no error to notice.
--
-- Safe because this is callable only from SECURITY DEFINER RPCs that have
-- already checked their own key, and it is NEVER granted to `authenticated`.
--
-- Recoveries are counted from ALL salary_payment rows, paid or not: a prepared
-- recovery must lower the balance, or the next period would suggest recovering
-- the same money again.
create or replace function public.advance_balance_of(p_profile uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(
    coalesce((
      select sum(amount) from public.staff_advance
      where profile_id = p_profile and status = 'approved'
    ), 0)
    -
    coalesce((
      select sum(advance_recovery) from public.salary_payment
      where profile_id = p_profile
    ), 0)
  , 2)
$$;
-- Postgres grants EXECUTE to PUBLIC by default, so simply omitting a
-- `grant ... to authenticated` withholds NOTHING. The revoke is the actual
-- enforcement — same as attendance_tally (0029:274), consume_fresh_fifo
-- (0031:53) and bill_payload (0031:75).
revoke execute on function public.advance_balance_of(uuid) from public;

-- ─── Internal: the cap, in one place ────────────────────────────────────────
-- Raises unless (approved balance + pending + p_extra) <= monthly_salary.
--
-- Pending is included so two requests that each pass individually cannot
-- together breach the cap. Re-checked at approval because monthly_salary may
-- have moved, or another pending advance may have been approved, in between.
create or replace function public.advance_cap_check(p_profile uuid, p_extra numeric)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_salary numeric; v_bal numeric; v_pending numeric; v_name text;
begin
  select name into v_name from public.profiles where id = p_profile;
  select coalesce(monthly_salary, 0) into v_salary
    from public.employee_salary where profile_id = p_profile;
  v_salary := coalesce(v_salary, 0);

  -- A zero or unset salary means a zero cap: no advance is possible.
  if v_salary <= 0 then
    raise exception 'set a monthly salary for % first', v_name;
  end if;

  v_bal := public.advance_balance_of(p_profile);
  select coalesce(sum(amount), 0) into v_pending
    from public.staff_advance where profile_id = p_profile and status = 'pending';

  if round(v_bal + v_pending + coalesce(p_extra, 0), 2) > v_salary then
    raise exception
      'that would take %''s advances to %, above their monthly salary of %',
      v_name, round(v_bal + v_pending + coalesce(p_extra, 0), 2), v_salary;
  end if;
end $$;
-- Ungated internal helper, and its error message leaks a name and an exact
-- monthly salary — so it must be unreachable from the client. See the note on
-- advance_balance_of above: the revoke, not the missing grant, is what does it.
revoke execute on function public.advance_cap_check(uuid, numeric) from public;

-- ─── Read surface ───────────────────────────────────────────────────────────
-- NOTE: columns are APPENDED, never inserted mid-list or reordered. Same rule
-- as salary_payment_v and items_v; the client reads `select *` and maps by name.
create or replace view public.staff_advance_v as
  select
    a.id, a.profile_id, a.amount, a.note, a.status,
    a.requested_on, a.approved_on, a.payment_mode, a.reject_reason,
    a.created_at, a.updated_at,
    e.name as employee_name,
    rq.name as requested_by_name,
    dc.name as decided_by_name
  from public.staff_advance a
  join public.profiles e on e.id = a.profile_id
  left join public.profiles rq on rq.id = a.requested_by
  left join public.profiles dc on dc.id = a.decided_by
  where public.has_perm('advance.view')
    and e.role <> 'Owner';
grant select on public.staff_advance_v to authenticated;

-- One row per non-Owner employee. Left-joined from profiles, so the roster is
-- complete and someone who has never taken an advance shows zeroes.
create or replace view public.staff_advance_balance_v as
  select
    p.id as profile_id,
    p.name as employee_name,
    coalesce(a.advanced, 0)::numeric  as total_advanced,
    coalesce(r.recovered, 0)::numeric as total_recovered,
    round(coalesce(a.advanced, 0) - coalesce(r.recovered, 0), 2) as balance,
    coalesce(a.pending_amount, 0)::numeric as pending_amount,
    -- Earliest approved advance while anything is outstanding. NOT a per-advance
    -- closure date: there is no FIFO allocation, by design.
    case when round(coalesce(a.advanced, 0) - coalesce(r.recovered, 0), 2) > 0
         then a.oldest_approved end as oldest_open,
    coalesce(es.monthly_salary, 0)::numeric as monthly_salary
  from public.profiles p
  left join (
    select profile_id,
           sum(case when status = 'approved' then amount else 0 end) as advanced,
           sum(case when status = 'pending'  then amount else 0 end) as pending_amount,
           min(case when status = 'approved' then approved_on end)   as oldest_approved
    from public.staff_advance
    group by profile_id
  ) a on a.profile_id = p.id
  left join (
    select profile_id, sum(advance_recovery) as recovered
    from public.salary_payment
    group by profile_id
  ) r on r.profile_id = p.id
  left join public.employee_salary es on es.profile_id = p.id
  where public.has_perm('advance.view')
    and p.role <> 'Owner'
  order by p.name;
grant select on public.staff_advance_balance_v to authenticated;

-- ─── Request an advance ─────────────────────────────────────────────────────
create or replace function public.request_advance(
  p_profile uuid,
  p_amount  numeric,
  p_note    text default '',
  p_tz      text default 'UTC'
)
returns public.staff_advance_v
language plpgsql security definer set search_path = public as $$
declare v_row public.staff_advance_v; v_id uuid; v_name text; v_role text; v_today date;
begin
  if not public.has_perm('advance.request') then raise exception 'forbidden'; end if;
  -- The return row is read back through staff_advance_v, which is gated on
  -- advance.view. Without it the write would succeed and then hand back NULL.
  if not public.has_perm('advance.view') then
    raise exception 'recording an advance also needs the "view advances" permission';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'an advance must be more than zero';
  end if;

  select name, role into v_name, v_role from public.profiles where id = p_profile;
  if not found then raise exception 'employee not found'; end if;
  if v_role = 'Owner' then raise exception 'the Owner is not on the payroll'; end if;

  v_today := (now() at time zone p_tz)::date;
  perform public.advance_cap_check(p_profile, round(p_amount, 2));

  insert into public.staff_advance (profile_id, amount, note, requested_on, requested_by)
    values (p_profile, round(p_amount, 2), btrim(coalesce(p_note, '')), v_today, auth.uid())
    returning id into v_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('advance', auth.uid(), v_name, round(p_amount, 2),
            'Requested advance of ' || round(p_amount, 2)::text
            || case when btrim(coalesce(p_note, '')) <> ''
                    then ' — ' || btrim(p_note) else '' end);

  select * into v_row from public.staff_advance_v where id = v_id;
  return v_row;
end $$;
grant execute on function public.request_advance(uuid, numeric, text, text) to authenticated;

-- ─── Approve (and disburse, in the same step) ───────────────────────────────
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
  if p_mode is null or p_mode not in ('Cash','UPI','Bank Transfer','Cheque') then
    raise exception 'choose a payment mode';
  end if;
  if p_approved_on is null then raise exception 'approval date required'; end if;
  if p_approved_on > (now() at time zone p_tz)::date then
    raise exception 'approval date cannot be in the future';
  end if;

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

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('advance_pay', auth.uid(), v_name, v_amount,
            'Approved advance ' || v_amount::text || ' by ' || p_mode
            || ' on ' || p_approved_on::text);

  select * into v_row from public.staff_advance_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.approve_advance(uuid, date, text, text) to authenticated;

-- ─── Reject ─────────────────────────────────────────────────────────────────
create or replace function public.reject_advance(p_id uuid, p_reason text)
returns public.staff_advance_v
language plpgsql security definer set search_path = public as $$
declare v_row public.staff_advance_v; v_name text; v_status text; v_amount numeric;
begin
  if not public.has_perm('advance.approve') then raise exception 'forbidden'; end if;
  -- The return row is read back through staff_advance_v, which is gated on
  -- advance.view. Without it the write would succeed and then hand back NULL.
  if not public.has_perm('advance.view') then
    raise exception 'approving an advance also needs the "view advances" permission';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'give a reason when refusing an advance';
  end if;

  select p.name, a.status, a.amount into v_name, v_status, v_amount
  from public.staff_advance a join public.profiles p on p.id = a.profile_id
  where a.id = p_id;
  if not found then raise exception 'advance not found'; end if;
  if v_status <> 'pending' then
    raise exception 'this advance has already been %', v_status;
  end if;

  update public.staff_advance
    set status = 'rejected', reject_reason = btrim(p_reason), decided_by = auth.uid()
    where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('advance', auth.uid(), v_name, v_amount,
            'Rejected advance of ' || v_amount::text || ': ' || btrim(p_reason));

  select * into v_row from public.staff_advance_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.reject_advance(uuid, text) to authenticated;

-- ─── Delete a pending request ───────────────────────────────────────────────
create or replace function public.delete_advance(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_status text;
begin
  if not public.has_perm('advance.approve') then raise exception 'forbidden'; end if;

  select p.name, a.status into v_name, v_status
  from public.staff_advance a join public.profiles p on p.id = a.profile_id
  where a.id = p_id;
  if not found then raise exception 'advance not found'; end if;
  -- An approved advance is money that moved: it stays for audit, mirroring
  -- "a paid record cannot be deleted" in delete_salary_payment.
  if v_status <> 'pending' then
    raise exception 'only a pending request can be deleted';
  end if;

  delete from public.staff_advance where id = p_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('advance', auth.uid(), v_name, 'Removed a pending advance request');
end $$;
grant execute on function public.delete_advance(uuid) to authenticated;

-- ─── Set the recovery on a payroll record ───────────────────────────────────
-- Rides on `salary.edit`: this is a payroll decision, made on the payroll
-- screen, not an advance decision.
create or replace function public.set_advance_recovery(
  p_payment_id uuid, p_amount numeric
)
returns public.salary_payment_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.salary_payment_v;
  v_name text; v_status text; v_net numeric; v_profile uuid;
  v_existing numeric; v_bal numeric; v_ceiling numeric; v_amt numeric;
  v_year int; v_month int;
begin
  if not public.has_perm('salary.edit') then raise exception 'forbidden'; end if;

  select p.name, sp.status, sp.net, sp.profile_id, sp.advance_recovery,
         sp.period_year, sp.period_month
    into v_name, v_status, v_net, v_profile, v_existing, v_year, v_month
  from public.salary_payment sp join public.profiles p on p.id = sp.profile_id
  where sp.id = p_payment_id;
  if not found then raise exception 'payroll record not found'; end if;
  if v_status = 'paid' then
    raise exception 'this period is already paid — mark it unpaid before editing';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt < 0 then raise exception 'a recovery cannot be negative'; end if;

  -- THE CEILING. This record's own existing recovery is already subtracted
  -- inside advance_balance_of, so checking against the raw balance would make
  -- lowering a recovery impossible and raising one off by the old amount. Add
  -- it back to get the balance as it stands with THIS record excluded.
  v_bal := public.advance_balance_of(v_profile);
  v_ceiling := least(round(v_bal + v_existing, 2), v_net);

  if v_amt > v_ceiling then
    raise exception 'the most that can be recovered from this period is %', v_ceiling;
  end if;

  update public.salary_payment
    set advance_recovery = v_amt,
        net_payable = round(net - v_amt, 2),
        recorded_by = auth.uid()
    where id = p_payment_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('advance', auth.uid(), v_name, v_amt,
            'Recovered ' || v_amt::text || ' from payroll '
            || v_year::text || '-' || lpad(v_month::text, 2, '0'));

  select * into v_row from public.salary_payment_v where id = p_payment_id;
  return v_row;
end $$;
grant execute on function public.set_advance_recovery(uuid, numeric) to authenticated;

-- Appending advance_recovery and net_payable. Reproduced verbatim from 0030
-- with two columns added at the END — CREATE OR REPLACE VIEW cannot reorder,
-- and dropping would need CASCADE and take the four functions with it.
create or replace view public.salary_payment_v as
  select
    sp.id, sp.profile_id, sp.period_year, sp.period_month,
    sp.gross, sp.calendar_days, sp.unpaid_days, sp.deduction,
    sp.computed_net, sp.net, sp.override_reason,
    sp.status, sp.paid_on, sp.payment_mode, sp.created_at, sp.updated_at,
    e.name as employee_name,
    r.name as recorded_by_name,
    sp.recorded_days,
    sp.advance_recovery,
    sp.net_payable
  from public.salary_payment sp
  join public.profiles e on e.id = sp.profile_id
  left join public.profiles r on r.id = sp.recorded_by
  where public.has_perm('salary.view')
    and e.role <> 'Owner';
grant select on public.salary_payment_v to authenticated;
