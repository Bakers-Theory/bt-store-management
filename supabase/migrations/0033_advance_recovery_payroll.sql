-- ============================================================================
-- BT Store Management — advance recovery in payroll (Phase 3, part 2)
--
-- The ONLY two existing RPCs that advances touch. Split from 0032 so the
-- additive schema and the change to shipped payroll behaviour can be reviewed,
-- applied, and rolled back independently.
--
-- Six of the nine salary RPCs are deliberately NOT here — mark_salary_paid,
-- mark_salary_unpaid, delete_salary_payment, payroll_compute,
-- set_employee_salary and employee_salaries need no change at all, because the
-- balance is computed rather than stored. Deleting a payroll record drops its
-- recovery from the sum and the balance restores itself; reopening one leaves
-- the recovery in place, which is also correct.
-- ============================================================================

-- ─── save_salary_payment: write net_payable, and clamp a stranded recovery ──
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
  v_gross numeric; v_unpaid numeric; v_recorded int;
  v_ded numeric; v_net numeric; v_final numeric;
  -- NEW: the existing recovery, and the value it may have to be clamped to.
  v_recovery numeric := 0; v_clamped numeric;
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
  if v_from > (now() at time zone p_tz)::date then
    raise exception 'that payroll period has not started yet';
  end if;

  -- NEW: read the existing status AND recovery in one go.
  -- A paid record is closed: reopen it with mark_salary_unpaid first. Without
  -- this, an edit could silently alter a figure already handed over.
  select status, advance_recovery into v_status, v_recovery
    from public.salary_payment
    where profile_id = p_profile and period_year = p_year and period_month = p_month;
  v_recovery := coalesce(v_recovery, 0);
  if v_status = 'paid' then
    raise exception 'this period is already paid — mark it unpaid before editing';
  end if;

  select coalesce(monthly_salary, 0) into v_gross
    from public.employee_salary where profile_id = p_profile;
  v_gross := coalesce(v_gross, 0);
  if v_gross <= 0 then
    raise exception 'set a monthly salary for % first', v_name;
  end if;

  select coalesce(t.unpaid_days, 0), coalesce(t.recorded, 0)
    into v_unpaid, v_recorded
    from public.attendance_tally(v_from, v_to) t where t.profile_id = p_profile;
  v_unpaid := coalesce(v_unpaid, 0);
  v_recorded := coalesce(v_recorded, 0);

  select c.deduction, c.net into v_ded, v_net
    from public.payroll_compute(v_gross, v_days, v_unpaid) c;

  v_final := coalesce(round(p_net, 2), v_net);
  if v_final < 0 then raise exception 'net pay cannot be negative'; end if;
  if v_final <> v_net and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'give a reason when overriding the calculated net pay';
  end if;

  -- NEW: an attendance edit (or a downward override) can drop the net below a
  -- recovery already set, which `recovery_within_net` would reject — the
  -- recompute would fail with a constraint error rather than doing the obvious
  -- thing. Clamp the recovery down and say so in the log, so a silently
  -- reduced recovery is never invisible. v_recovery is the value as read at
  -- the start of this call — see the on-conflict clause below, which re-reads
  -- the row's current stored value rather than trusting this variable, since
  -- it may have gone stale by the time the upsert runs.
  v_clamped := least(v_recovery, v_final);

  insert into public.salary_payment (
    profile_id, period_year, period_month, gross, calendar_days, recorded_days,
    unpaid_days, deduction, computed_net, net, override_reason, status,
    recorded_by, advance_recovery, net_payable
  ) values (
    p_profile, p_year, p_month, v_gross, v_days, v_recorded, v_unpaid,
    v_ded, v_net, v_final,
    case when v_final <> v_net then btrim(p_reason) else '' end,
    'unpaid', auth.uid(), v_clamped, round(v_final - v_clamped, 2)
  )
  on conflict (profile_id, period_year, period_month) do update
    set gross = excluded.gross,
        calendar_days = excluded.calendar_days,
        recorded_days = excluded.recorded_days,
        unpaid_days = excluded.unpaid_days,
        deduction = excluded.deduction,
        computed_net = excluded.computed_net,
        net = excluded.net,
        override_reason = excluded.override_reason,
        recorded_by = excluded.recorded_by,
        -- NEW: re-clamp against the row's CURRENT stored advance_recovery,
        -- not the v_recovery variable read near the top of this call — that
        -- read is now stale if set_advance_recovery (0032) committed a change
        -- in between, and writing it back verbatim would silently restore a
        -- recovery the operator had just lowered. least(...) is the same
        -- clamp as the insert path, keeping recovery_within_net satisfied
        -- when the new net has fallen below the stored recovery.
        advance_recovery = least(salary_payment.advance_recovery, excluded.net),
        net_payable = round(excluded.net - least(salary_payment.advance_recovery, excluded.net), 2);

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('salary', auth.uid(), v_name, v_final,
            'Payroll ' || p_year::text || '-' || lpad(p_month::text, 2, '0')
            || ': net ' || v_final::text
            || case when v_final <> v_net
                    then ' (overridden from ' || v_net::text || ': ' || btrim(p_reason) || ')'
                    else '' end);

  -- NEW: a clamp changes a money figure, so it gets its own audit line.
  if v_clamped < v_recovery then
    insert into public.activity_log (type, actor, item_name, total, notes)
      values ('advance', auth.uid(), v_name, v_clamped,
              'Recovery reduced ' || v_recovery::text || ' → ' || v_clamped::text
              || ' (net fell after a recalculation)');
  end if;

  select * into v_row from public.salary_payment_v
    where profile_id = p_profile and period_year = p_year and period_month = p_month;
  return v_row;
end $$;
grant execute on function public.save_salary_payment(uuid, int, int, numeric, text, text) to authenticated;

-- ─── payroll_preview: expose the balance, the recovery and the payable ──────
-- The balance comes from advance_balance_of, NOT from staff_advance_balance_v:
-- this function is gated on salary.view, and the view is gated on advance.view,
-- so a payroll operator without advance.view would silently see a zero balance.
-- Reads attendance through `attendance_tally`, which is NOT gated on
-- attendance.view — payroll must work for someone who may only hold salary.*.
-- Return type changes across versions, so drop first.
drop function if exists public.payroll_preview(int, int);
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
  -- What the calculation said when the record was prepared. Differs from
  -- `computed_net` only when attendance moved afterwards, which is how the UI
  -- distinguishes "someone adjusted this" from "this is stale".
  stored_computed_net numeric,
  override_reason     text,
  paid_on       date,
  payment_mode  text,
  -- NEW, appended. No `suggested_recovery`: the client derives the pre-fill
  -- from advance_balance + advance_recovery + net, so a server-side copy would
  -- be a third definition of the same figure.
  advance_balance    numeric,
  advance_recovery   numeric,
  net_payable        numeric
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
    sp.computed_net,
    coalesce(sp.override_reason, ''),
    sp.paid_on,
    sp.payment_mode,
    -- The balance as it stands, which already excludes this record's own
    -- recovery via advance_balance_of.
    b.bal,
    coalesce(sp.advance_recovery, 0)::numeric,
    coalesce(sp.net_payable, coalesce(sp.net, c.net))::numeric
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
  cross join lateral (select public.advance_balance_of(p.id) as bal) b
  where p.role <> 'Owner'
  order by p.name;
end $$;
grant execute on function public.payroll_preview(int, int) to authenticated;
