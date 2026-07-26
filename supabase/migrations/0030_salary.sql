-- ============================================================================
-- BT Store Management — salary & payroll (Phase 2 of the HR module)
--
-- Payroll model (decided with the owner):
--   per-day rate = monthly_salary / calendar days in the period month
--   deduction    = unpaid_days × per-day rate   (Leave = 1, Half Day = 0.5)
--   net          = gross − deduction
--
-- Two consequences that shape the schema:
--
--   1. UNRECORDED DAYS NEVER DEDUCT. There is no 'absent' status; a day with no
--      record is data not yet entered. Payroll therefore deducts only from
--      `unpaid_days` and exposes `recorded` vs `calendar_days` so a gap is
--      visible before anyone is paid, rather than silently charged for.
--   2. Salary lives in its OWN table, not on `profiles`. Every authed user can
--      read their own profile row, so a salary column there would ride along in
--      that fetch. A separate table gets its own RLS keyed on `salary.view`.
--
-- Permissions: `salary.view`, `salary.edit`, `salary.pay` — all grantable, but
-- in NO preset, so salary is Owner-only until deliberately delegated (the same
-- treatment as `staff.manage`).
--
-- The Owner is excluded throughout, exactly as in attendance: they are the
-- proprietor, not someone on the payroll.
-- ============================================================================

-- ─── Audit log: salary entry types ──────────────────────────────────────────
alter table public.activity_log drop constraint if exists activity_log_type_check;
alter table public.activity_log add constraint activity_log_type_check
  check (type in ('in','out','bill','cancel','delete','open','close',
                  'settings','staff_add','staff_edit','staff_remove','password',
                  'attendance','salary','salary_pay'));

-- ─── Each employee's salary ─────────────────────────────────────────────────
create table if not exists public.employee_salary (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

drop trigger if exists employee_salary_updated_at on public.employee_salary;
create trigger employee_salary_updated_at before update on public.employee_salary
  for each row execute function public.set_updated_at();

-- ─── One payroll record per employee per month ──────────────────────────────
create table if not exists public.salary_payment (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  period_year   int  not null check (period_year between 2000 and 2200),
  period_month  int  not null check (period_month between 1 and 12),
  -- Snapshot of the inputs, so a later salary change never rewrites history.
  gross         numeric(12,2) not null,
  calendar_days int           not null,
  unpaid_days   numeric(5,1)  not null default 0,
  deduction     numeric(12,2) not null default 0,
  computed_net  numeric(12,2) not null,
  -- What is actually being paid; may differ from computed_net.
  net           numeric(12,2) not null,
  override_reason text not null default '',
  status        text not null default 'unpaid' check (status in ('unpaid','paid')),
  paid_on       date,
  payment_mode  text not null default ''
    check (payment_mode in ('', 'Cash', 'UPI', 'Bank Transfer', 'Cheque')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  recorded_by   uuid references public.profiles(id) on delete set null,

  -- Story 4: no duplicate payment for the same payroll period. A database
  -- guarantee, not a UI check.
  constraint one_payment_per_period unique (profile_id, period_year, period_month),
  -- An override must say why, so an unexplained figure can't be filed.
  constraint override_needs_reason
    check (net = computed_net or btrim(override_reason) <> ''),
  -- "Paid" is only meaningful with a date and a mode.
  constraint paid_needs_date_and_mode
    check (status = 'unpaid' or (paid_on is not null and payment_mode <> ''))
);

create index if not exists salary_payment_period_idx
  on public.salary_payment (period_year desc, period_month desc);

drop trigger if exists salary_payment_updated_at on public.salary_payment;
create trigger salary_payment_updated_at before update on public.salary_payment
  for each row execute function public.set_updated_at();

-- ─── RLS: reads need salary.view; writes only through the RPCs below ────────
alter table public.employee_salary enable row level security;
drop policy if exists employee_salary_read on public.employee_salary;
create policy employee_salary_read on public.employee_salary for select
  using (public.has_perm('salary.view'));

alter table public.salary_payment enable row level security;
drop policy if exists salary_payment_read on public.salary_payment;
create policy salary_payment_read on public.salary_payment for select
  using (public.has_perm('salary.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
create or replace view public.salary_payment_v as
  select
    sp.id, sp.profile_id, sp.period_year, sp.period_month,
    sp.gross, sp.calendar_days, sp.unpaid_days, sp.deduction,
    sp.computed_net, sp.net, sp.override_reason,
    sp.status, sp.paid_on, sp.payment_mode, sp.created_at, sp.updated_at,
    e.name as employee_name,
    r.name as recorded_by_name
  from public.salary_payment sp
  join public.profiles e on e.id = sp.profile_id
  left join public.profiles r on r.id = sp.recorded_by
  where public.has_perm('salary.view')
    and e.role <> 'Owner';
grant select on public.salary_payment_v to authenticated;

-- Salary list with names, for the setup screen. Employees with no salary row
-- yet appear with 0 so the list is the full roster.
create or replace function public.employee_salaries()
returns table (profile_id uuid, employee_name text, monthly_salary numeric, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         coalesce(es.monthly_salary, 0)::numeric,
         es.updated_at
  from public.profiles p
  left join public.employee_salary es on es.profile_id = p.id
  where public.has_perm('salary.view')
    and p.role <> 'Owner'
  order by p.name
$$;
grant execute on function public.employee_salaries() to authenticated;

-- ─── Set an employee's salary ───────────────────────────────────────────────
create or replace function public.set_employee_salary(p_profile uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_role text; v_old numeric;
begin
  if not public.has_perm('salary.edit') then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'salary cannot be negative'; end if;

  select name, role into v_name, v_role from public.profiles where id = p_profile;
  if not found then raise exception 'employee not found'; end if;
  if v_role = 'Owner' then
    raise exception 'the Owner is not on the payroll';
  end if;

  select monthly_salary into v_old from public.employee_salary where profile_id = p_profile;

  insert into public.employee_salary (profile_id, monthly_salary, updated_by)
    values (p_profile, p_amount, auth.uid())
  on conflict (profile_id) do update
    set monthly_salary = excluded.monthly_salary,
        updated_by = excluded.updated_by;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('salary', auth.uid(), v_name,
            case when v_old is null
                 then 'Set salary to ' || p_amount::text
                 else 'Changed salary ' || v_old::text || ' → ' || p_amount::text end);
end $$;
grant execute on function public.set_employee_salary(uuid, numeric) to authenticated;

-- ─── Internal: the payroll arithmetic, in one place ─────────────────────────
-- Written step by step because the rounding ORDER is what matters: the
-- deduction is rounded to paise first, then the net is derived from it, so
-- `gross - deduction = net` holds exactly and a payslip always adds up.
create or replace function public.payroll_compute(
  p_gross numeric, p_calendar_days int, p_unpaid_days numeric
)
returns table (deduction numeric, net numeric)
language plpgsql immutable set search_path = public as $$
declare v_per_day numeric; v_ded numeric; v_net numeric;
begin
  if coalesce(p_calendar_days, 0) <= 0 then
    raise exception 'calendar days must be positive';
  end if;
  v_per_day := p_gross / p_calendar_days;
  -- Deduction can never exceed the gross, however much leave was taken.
  v_ded := least(p_gross, round(v_per_day * coalesce(p_unpaid_days, 0), 2));
  v_net := round(p_gross - v_ded, 2);
  return query select v_ded, v_net;
end $$;

-- ─── Payroll preview for a month ────────────────────────────────────────────
-- Reads attendance through `attendance_tally`, which is NOT gated on
-- attendance.view — payroll must work for someone who may only hold salary.*.
create or replace function public.payroll_preview(p_year int, p_month int)
returns table (
  profile_id    uuid,
  employee_name text,
  gross         numeric,
  calendar_days int,
  recorded      bigint,
  unpaid_days   numeric,
  deduction     numeric,
  computed_net  numeric,
  payment_id    uuid,
  status        text,
  net           numeric,
  paid_on       date,
  payment_mode  text
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date; v_to date; v_days int;
begin
  if not public.has_perm('salary.view') then raise exception 'forbidden'; end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'month must be 1-12';
  end if;
  v_from := make_date(p_year, p_month, 1);
  v_to   := (v_from + interval '1 month - 1 day')::date;
  v_days := (v_to - v_from) + 1;

  return query
  select
    p.id,
    p.name,
    coalesce(es.monthly_salary, 0)::numeric,
    v_days,
    coalesce(t.recorded, 0)::bigint,
    coalesce(t.unpaid_days, 0)::numeric,
    c.deduction,
    c.net,
    sp.id,
    coalesce(sp.status, 'none'),
    sp.net,
    sp.paid_on,
    sp.payment_mode
  from public.profiles p
  left join public.employee_salary es on es.profile_id = p.id
  left join public.attendance_tally(v_from, v_to) t on t.profile_id = p.id
  left join public.salary_payment sp
    on sp.profile_id = p.id
   and sp.period_year = p_year
   and sp.period_month = p_month
  cross join lateral public.payroll_compute(
    coalesce(es.monthly_salary, 0), v_days, coalesce(t.unpaid_days, 0)
  ) c
  where p.role <> 'Owner'
  order by p.name;
end $$;
grant execute on function public.payroll_preview(int, int) to authenticated;

-- ─── Create or adjust a payroll record ──────────────────────────────────────
-- Recomputes from live attendance every time, so a record can't drift from the
-- days behind it. `p_net` null means "take the computed figure".
create or replace function public.save_salary_payment(
  p_profile uuid,
  p_year    int,
  p_month   int,
  p_net     numeric default null,
  p_reason  text default '',
  p_tz      text default 'UTC'
)
returns public.salary_payment_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.salary_payment_v;
  v_name text; v_role text; v_status text;
  v_from date; v_to date; v_days int;
  v_gross numeric; v_unpaid numeric; v_ded numeric; v_net numeric; v_final numeric;
begin
  if not public.has_perm('salary.edit') then raise exception 'forbidden'; end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'month must be 1-12';
  end if;

  select name, role into v_name, v_role from public.profiles where id = p_profile;
  if not found then raise exception 'employee not found'; end if;
  if v_role = 'Owner' then raise exception 'the Owner is not on the payroll'; end if;

  v_from := make_date(p_year, p_month, 1);
  v_to   := (v_from + interval '1 month - 1 day')::date;
  v_days := (v_to - v_from) + 1;
  -- A payroll period cannot be run before it has started.
  if v_from > (now() at time zone p_tz)::date then
    raise exception 'that payroll period has not started yet';
  end if;

  -- A paid record is closed: reopen it with mark_salary_unpaid first. Without
  -- this, an edit could silently alter a figure already handed over.
  select status into v_status from public.salary_payment
    where profile_id = p_profile and period_year = p_year and period_month = p_month;
  if v_status = 'paid' then
    raise exception 'this period is already paid — mark it unpaid before editing';
  end if;

  select coalesce(monthly_salary, 0) into v_gross
    from public.employee_salary where profile_id = p_profile;
  v_gross := coalesce(v_gross, 0);
  if v_gross <= 0 then
    raise exception 'set a monthly salary for % first', v_name;
  end if;

  select coalesce(t.unpaid_days, 0) into v_unpaid
    from public.attendance_tally(v_from, v_to) t where t.profile_id = p_profile;
  v_unpaid := coalesce(v_unpaid, 0);

  select c.deduction, c.net into v_ded, v_net
    from public.payroll_compute(v_gross, v_days, v_unpaid) c;

  v_final := coalesce(round(p_net, 2), v_net);
  if v_final < 0 then raise exception 'net pay cannot be negative'; end if;
  if v_final <> v_net and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'give a reason when overriding the calculated net pay';
  end if;

  insert into public.salary_payment (
    profile_id, period_year, period_month, gross, calendar_days, unpaid_days,
    deduction, computed_net, net, override_reason, status, recorded_by
  ) values (
    p_profile, p_year, p_month, v_gross, v_days, v_unpaid,
    v_ded, v_net, v_final,
    case when v_final <> v_net then btrim(p_reason) else '' end,
    'unpaid', auth.uid()
  )
  on conflict (profile_id, period_year, period_month) do update
    set gross = excluded.gross,
        calendar_days = excluded.calendar_days,
        unpaid_days = excluded.unpaid_days,
        deduction = excluded.deduction,
        computed_net = excluded.computed_net,
        net = excluded.net,
        override_reason = excluded.override_reason,
        recorded_by = excluded.recorded_by;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('salary', auth.uid(), v_name, v_final,
            'Payroll ' || p_year::text || '-' || lpad(p_month::text, 2, '0')
            || ': net ' || v_final::text
            || case when v_final <> v_net
                    then ' (overridden from ' || v_net::text || ': ' || btrim(p_reason) || ')'
                    else '' end);

  select * into v_row from public.salary_payment_v
    where profile_id = p_profile and period_year = p_year and period_month = p_month;
  return v_row;
end $$;
grant execute on function public.save_salary_payment(uuid, int, int, numeric, text, text) to authenticated;

-- ─── Mark paid / unpaid ─────────────────────────────────────────────────────
create or replace function public.mark_salary_paid(
  p_id uuid, p_paid_on date, p_mode text, p_tz text default 'UTC'
)
returns public.salary_payment_v
language plpgsql security definer set search_path = public as $$
declare v_row public.salary_payment_v; v_name text; v_status text; v_net numeric;
begin
  if not public.has_perm('salary.pay') then raise exception 'forbidden'; end if;
  if p_mode is null or p_mode not in ('Cash','UPI','Bank Transfer','Cheque') then
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

  update public.salary_payment
    set status = 'paid', paid_on = p_paid_on, payment_mode = p_mode, recorded_by = auth.uid()
    where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('salary_pay', auth.uid(), v_name, v_net,
            'Paid ' || v_net::text || ' by ' || p_mode || ' on ' || p_paid_on::text);

  select * into v_row from public.salary_payment_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.mark_salary_paid(uuid, date, text, text) to authenticated;

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

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('salary_pay', auth.uid(), v_name, v_net, 'Reopened payroll (marked unpaid)');

  select * into v_row from public.salary_payment_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.mark_salary_unpaid(uuid) to authenticated;

-- ─── Delete an unpaid payroll record ────────────────────────────────────────
create or replace function public.delete_salary_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_status text;
begin
  if not public.has_perm('salary.edit') then raise exception 'forbidden'; end if;

  select p.name, sp.status into v_name, v_status
  from public.salary_payment sp join public.profiles p on p.id = sp.profile_id
  where sp.id = p_id;
  if not found then raise exception 'payroll record not found'; end if;
  -- A paid record is history and stays for audit.
  if v_status = 'paid' then
    raise exception 'a paid record cannot be deleted — mark it unpaid first';
  end if;

  delete from public.salary_payment where id = p_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('salary', auth.uid(), v_name, 'Removed an unpaid payroll record');
end $$;
grant execute on function public.delete_salary_payment(uuid) to authenticated;
