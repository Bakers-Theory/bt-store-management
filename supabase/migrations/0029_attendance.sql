-- ============================================================================
-- BT Store Management — staff attendance (Phase 1 of the HR module)
--
-- Employees ARE the `profiles` rows: someone who never logs in still gets a
-- staff account (with an empty `perms`), so there is no separate roster to keep
-- in sync with the login list.
--
-- The Owner is excluded everywhere in this module — they are the proprietor, not
-- an employee whose days get marked. Enforced in three places so it holds no
-- matter the entry point: the roster, the read view, and the write RPC.
--
-- One record per employee per day, enforced by a unique index rather than by
-- application logic — a double-tap or a second device cannot create a duplicate.
-- Writing an existing day is an *edit*, which is why the RPC upserts.
--
-- There is deliberately NO 'absent' status: every day is Present, Half Day,
-- Leave or Holiday. Leave is unpaid, so time off is recorded as leave rather
-- than as an absence.
--
-- An UNRECORDED day is therefore not an absence — it is data not yet entered,
-- and it must never cost anyone money. Payroll deducts from `unpaid_days`
-- (leave + half days) and warns about gaps instead of charging for them.
--
-- Two new permission keys, both grantable: `attendance.view` and
-- `attendance.edit`. Salary keys arrive with Phase 2 (migration 0030).
-- ============================================================================

-- ─── Table ──────────────────────────────────────────────────────────────────
create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  on_date    date not null,
  -- Constraint added separately below so it carries a known name and can be
  -- tightened on a re-run (see the status migration block).
  status     text not null,
  note       text not null default '',
  -- Who recorded it. `set null` on delete so removing a staff account never
  -- destroys the attendance history of the people they marked.
  marked_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_one_per_day unique (profile_id, on_date)
);

-- ─── Allowed statuses ───────────────────────────────────────────────────────
-- Runs only when the constraint is missing or still permits 'absent', so a
-- re-run never re-tightens (and never deletes) rows a later migration may have
-- legitimately widened the set to allow. Dropping 'absent' rows is lossless
-- under this model: no record means absent.
do $st$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.attendance'::regclass
    and conname = 'attendance_status_check';

  if v_def is null or v_def like '%absent%' then
    delete from public.attendance
      where status not in ('present','half_day','leave','holiday');
    alter table public.attendance drop constraint if exists attendance_status_check;
    alter table public.attendance add constraint attendance_status_check
      check (status in ('present','half_day','leave','holiday'));
  end if;
end $st$;

-- Date-first index serves the "who was in on this day" screen; the unique
-- constraint above already covers per-employee lookups.
create index if not exists attendance_date_idx on public.attendance (on_date desc);

drop trigger if exists attendance_updated_at on public.attendance;
create trigger attendance_updated_at before update on public.attendance
  for each row execute function public.set_updated_at();

-- ─── Audit log: allow the attendance entry type ─────────────────────────────
-- WIDEN ONLY. A later migration (0030) adds more types to this same constraint,
-- so blindly dropping and re-adding our list would narrow it on a re-run and
-- fail against rows that already use the newer types. Skip if 'attendance' is
-- already permitted.
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and conname = 'activity_log_type_check';

  if v_def is null or v_def not like '%attendance%' then
    alter table public.activity_log drop constraint if exists activity_log_type_check;
    alter table public.activity_log add constraint activity_log_type_check
      check (type in ('in','out','bill','cancel','delete','open','close',
                      'settings','staff_add','staff_edit','staff_remove','password',
                      'attendance'));
  end if;
end $ck$;

-- ─── RLS: reads need attendance.view; writes only via the RPCs below ────────
alter table public.attendance enable row level security;
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select
  using (public.has_perm('attendance.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
-- Resolves both names through a definer view, since staff can't read other
-- `profiles` rows directly. Gated on the same key as the policy above.
create or replace view public.attendance_v as
  select
    a.id, a.profile_id, a.on_date, a.status, a.note,
    a.created_at, a.updated_at,
    e.name as employee_name,
    m.name as marked_by_name
  from public.attendance a
  join public.profiles e on e.id = a.profile_id
  left join public.profiles m on m.id = a.marked_by
  where public.has_perm('attendance.view')
    and e.role <> 'Owner';
grant select on public.attendance_v to authenticated;

-- The roster the attendance screen lists, so it doesn't need `profiles` reads
-- (which are restricted to self + staff.manage). Name only — no role, no
-- permissions, no login handle. The Owner is not an employee, so they're out.
drop function if exists public.attendance_roster();
create or replace function public.attendance_roster()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name
  from public.profiles p
  where public.has_perm('attendance.view')
    and p.role <> 'Owner'
  order by p.name
$$;
grant execute on function public.attendance_roster() to authenticated;

-- ─── Write: one upsert, because re-marking a day IS the edit path ───────────
-- The unique constraint makes "no duplicates" a database guarantee; this
-- function turns a second write for the same day into an update instead of an
-- error, and logs it either way.
create or replace function public.set_attendance(
  p_profile uuid,
  p_date    date,
  p_status  text,
  p_note    text default '',
  p_tz      text default 'UTC'
)
returns public.attendance_v
language plpgsql security definer set search_path = public as $$
declare v_row public.attendance_v; v_name text; v_role text;
        v_existing text; v_existing_note text; v_found boolean;
        v_note text := coalesce(p_note, '');
begin
  if not public.has_perm('attendance.edit') then raise exception 'forbidden'; end if;
  if p_status not in ('present','half_day','leave','holiday') then
    raise exception 'unknown attendance status: %', p_status;
  end if;
  if p_date is null then raise exception 'date required'; end if;
  -- Attendance is a record of what happened, so the future is not markable.
  -- Compared in the caller's timezone, matching how the rest of the app treats
  -- calendar days.
  if p_date > (now() at time zone p_tz)::date then
    raise exception 'cannot record attendance for a future date';
  end if;

  select name, role into v_name, v_role from public.profiles where id = p_profile;
  if not found then raise exception 'employee not found'; end if;
  -- Guard the write too: without this an Owner row could be created that the
  -- view then hides, leaving data nobody can see or clear.
  if v_role = 'Owner' then
    raise exception 'the Owner is not an employee — attendance is not recorded for them';
  end if;

  select status, note into v_existing, v_existing_note from public.attendance
    where profile_id = p_profile and on_date = p_date;
  v_found := found;

  insert into public.attendance (profile_id, on_date, status, note, marked_by)
    values (p_profile, p_date, p_status, v_note, auth.uid())
  on conflict (profile_id, on_date) do update
    set status = excluded.status,
        note = excluded.note,
        marked_by = excluded.marked_by;

  -- Describe what actually changed, and stay silent on a true no-op: editing a
  -- note re-sends the status, which would otherwise log 'Changed present →
  -- present' every keystroke-save.
  if not v_found then
    insert into public.activity_log (type, actor, item_name, reason, notes)
      values ('attendance', auth.uid(), v_name, p_status,
              'Marked ' || p_status || ' on ' || p_date::text
              || case when v_note <> '' then ' — ' || v_note else '' end);
  elsif v_existing <> p_status then
    insert into public.activity_log (type, actor, item_name, reason, notes)
      values ('attendance', auth.uid(), v_name, p_status,
              'Changed ' || v_existing || ' → ' || p_status
              || ' on ' || p_date::text
              || case when v_note <> '' then ' — ' || v_note else '' end);
  elsif coalesce(v_existing_note, '') <> v_note then
    insert into public.activity_log (type, actor, item_name, reason, notes)
      values ('attendance', auth.uid(), v_name, p_status,
              case when v_note = ''
                   then 'Cleared the note on ' || p_date::text
                   else 'Note on ' || p_date::text || ': ' || v_note end);
  end if;

  select * into v_row from public.attendance_v
    where profile_id = p_profile and on_date = p_date;
  return v_row;
end $$;
grant execute on function public.set_attendance(uuid, date, text, text, text) to authenticated;

-- ─── Write: clear a day (undo a mis-tap) ────────────────────────────────────
create or replace function public.clear_attendance(p_profile uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_status text;
begin
  if not public.has_perm('attendance.edit') then raise exception 'forbidden'; end if;

  select p.name, a.status into v_name, v_status
  from public.attendance a join public.profiles p on p.id = a.profile_id
  where a.profile_id = p_profile and a.on_date = p_date;
  if not found then raise exception 'no attendance recorded for that day'; end if;

  delete from public.attendance where profile_id = p_profile and on_date = p_date;

  insert into public.activity_log (type, actor, item_name, reason, notes)
    values ('attendance', auth.uid(), v_name, v_status,
            'Cleared ' || v_status || ' on ' || p_date::text);
end $$;
grant execute on function public.clear_attendance(uuid, date) to authenticated;

-- ─── The weight table, in one place ─────────────────────────────────────────
-- Present and Holiday pay whole, Half Day pays half, Leave pays nothing.
-- Deliberately NOT permission-gated and revoked from public: payroll (0030)
-- must read these tallies even when the caller lacks `attendance.view`, and
-- both this and `attendance_summary` need the identical weights — a second copy
-- of the CASE expression is how payroll and attendance drift apart.
create or replace function public.attendance_tally(p_from date, p_to date)
returns table (
  profile_id   uuid,
  present      bigint,
  half_day     bigint,
  leave_days   bigint,
  holiday      bigint,
  recorded     bigint,
  payable_days numeric,
  unpaid_days  numeric
)
language sql stable security definer set search_path = public as $$
  select
    a.profile_id,
    count(*) filter (where a.status = 'present')  as present,
    count(*) filter (where a.status = 'half_day') as half_day,
    count(*) filter (where a.status = 'leave')    as leave_days,
    count(*) filter (where a.status = 'holiday')  as holiday,
    count(*)                                      as recorded,
    -- Days that earn pay.
    coalesce(sum(case a.status
      when 'present'  then 1
      when 'holiday'  then 1
      when 'half_day' then 0.5
      else 0                              -- leave earns nothing
    end), 0) as payable_days,
    -- Days deducted from a fixed monthly salary. Unrecorded days are absent from
    -- this sum entirely: a gap in data entry is not a deduction.
    coalesce(sum(case a.status
      when 'leave'    then 1
      when 'half_day' then 0.5
      else 0
    end), 0) as unpaid_days
  from public.attendance a
  where (p_from is null or a.on_date >= p_from)
    and (p_to   is null or a.on_date <= p_to)
  group by a.profile_id
$$;
revoke execute on function public.attendance_tally(date, date) from public;

-- ─── Summary: per-employee counts over a range ───────────────────────────────
-- Permission-gated wrapper around attendance_tally, resolving names and keeping
-- employees with no records in the result (so the roster stays complete).
-- Return type changes across versions, so drop first: Postgres refuses to
-- CREATE OR REPLACE a function with a different signature.
drop function if exists public.attendance_summary(date, date, uuid);
create or replace function public.attendance_summary(
  p_from    date default null,
  p_to      date default null,
  p_profile uuid default null
)
returns table (
  profile_id    uuid,
  employee_name text,
  present       bigint,
  half_day      bigint,
  leave_days    bigint,
  holiday       bigint,
  recorded      bigint,
  payable_days  numeric,
  unpaid_days   numeric
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.name,
    coalesce(t.present, 0)::bigint,
    coalesce(t.half_day, 0)::bigint,
    coalesce(t.leave_days, 0)::bigint,
    coalesce(t.holiday, 0)::bigint,
    coalesce(t.recorded, 0)::bigint,
    coalesce(t.payable_days, 0)::numeric,
    coalesce(t.unpaid_days, 0)::numeric
  from public.profiles p
  left join public.attendance_tally(p_from, p_to) t on t.profile_id = p.id
  where public.has_perm('attendance.view')
    and p.role <> 'Owner'
    and (p_profile is null or p.id = p_profile)
  order by p.name
$$;
grant execute on function public.attendance_summary(date, date, uuid) to authenticated;
