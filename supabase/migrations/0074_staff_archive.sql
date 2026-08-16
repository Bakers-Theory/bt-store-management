-- ============================================================================
-- BT Store Management — archive a staff member instead of deleting them
--
--   1. A STAFF MEMBER IS ARCHIVED, NEVER DELETED. Deleting the profile row took
--      their work with it: `attendance`, `employee_salary`, `salary_payment`
--      and `staff_advance` all cascade off profiles(id), and every other module
--      (bills, cash ledger, stock movements, asset custody) reads the name back
--      through a join. Archiving keeps the row, so every operation they ever
--      recorded stays exactly as it was, with their name on it.
--   2. ARCHIVED MEANS NO ACCESS, NOT JUST HIDDEN. `has_perm` returns false for
--      an archived profile, so a session that is already open loses every
--      module immediately. The login itself is blocked at the auth layer — the
--      API route bans the auth user — because a permission check cannot stop
--      someone from signing in.
--   3. THE OWNER IS NOT ARCHIVABLE, and only the Owner may archive anyone. Both
--      are enforced in /api/staff/archive; the one-Owner index means there is
--      never a moment with no one able to undo it.
--   4. ARCHIVED STAFF LEAVE THE PICK LISTS, NOT THE HISTORY. `attendance_roster`
--      and `employee_salaries` are the two rosters used to record NEW work, so
--      they drop archived people. Every report and view (attendance_summary,
--      salary_payment_v, staff_advance_balance_v, the cash ledger) is left
--      alone — that is the history decision 1 exists to protect.
-- ============================================================================

alter table public.profiles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

-- Only the Owner ever sees this list, and it is short; the partial index is for
-- the roster filters below, which run on every attendance and salary screen.
create index if not exists profiles_active_idx on public.profiles (name)
  where archived_at is null;

-- ─── Decision 2: an archived profile holds nothing ──────────────────────────
create or replace function public.has_perm(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.archived_at is null            -- ADDED IN 0074
      and (
        p.role = 'Owner'
        or perm = any (p.perms)
        or (perm = 'sales' and p.perms && array[
              'bill.create','bill.discount','bill.print','bill.cancel',
              'bill.delete','bill.history','customers.view','customers.edit'])
        or (perm = 'inventory' and p.perms && array[
              'stock.view','stock.in','stock.out','stock.expiry',
              'items.create','items.edit','items.delete','items.cost'])
        or (perm = 'analytics' and p.perms && array[
              'dashboard.view','dashboard.profit','reports.view','reports.export'])
      )
  )
$$;

-- ─── Decision 4: the two rosters that start new work ────────────────────────
create or replace function public.attendance_roster()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name
  from public.profiles p
  where public.has_perm('attendance.view')
    and p.role <> 'Owner'
    and p.archived_at is null              -- ADDED IN 0074
  order by p.name
$$;

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
    and p.archived_at is null              -- ADDED IN 0074
  order by p.name
$$;
