-- ============================================================================
-- BT Store Management — deleting an archived staff member for good
--
-- 0074 made archiving the way a staff member leaves. This adds the permanent
-- delete behind it, for the case where the record of the person is meant to go
-- as well. Only an ARCHIVED member can be deleted (enforced in
-- /api/staff/archive's DELETE), so the destructive step is always deliberate
-- and always second.
--
-- WHAT DELETE DOES, and why the database does it rather than the route:
--
--   GOES — the person and their employment record. Deleting the auth user
--     cascades to `profiles`, and `attendance`, `employee_salary`,
--     `salary_payment` and `staff_advance` cascade off that. Advances go with
--     the salary history deliberately: an advance is recovered THROUGH
--     salary_payment.advance_recovery and its balance is per-profile, so
--     keeping it without the salary rows would leave a balance owed by nobody.
--
--   STAYS — everything the store did. Bills, cash entries, stock movements,
--     purchase invoices, expenses, assets and custody all reference the profile
--     with ON DELETE SET NULL, so the rows survive; they simply stop naming
--     who keyed them in. Their money, stock and tax figures are untouched.
--
-- Two things stood in the way of that, and this migration removes both.
-- ============================================================================

-- ─── 1. The append-only guards must not mistake a cascade for an edit ───────
-- `created_by uuid references profiles(id) on delete set null` means the delete
-- issues an UPDATE against every history row the person ever wrote — and three
-- guards refused it, which is what made staff deletion fail with
-- "this entry came from a bill and cannot be edited here". Nulling `created_by`
-- is the FK forgetting who did it, not someone rewriting what happened.

-- True when the two row images are identical once the named columns are
-- ignored — i.e. the update touched only those columns.
create or replace function public.row_unchanged_except(
  p_old jsonb, p_new jsonb, p_cols text[]
)
returns boolean language sql immutable set search_path = public as $$
  select (p_old - p_cols) = (p_new - p_cols)
$$;

create or replace function public.cash_entry_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a cash book entry is never deleted — it is removed with a reason';
  end if;

  -- ADDED IN 0075: the staff-deletion cascade, not an edit. Checked first so
  -- none of the rules below can refuse it.
  if public.row_unchanged_except(to_jsonb(old), to_jsonb(new),
                                 array['created_by','deleted_by']) then
    return new;
  end if;

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

create or replace function public.cash_day_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a closed day is history and is reopened, never deleted';
  end if;

  -- ADDED IN 0075: as above. The day keeps every counted figure; it just stops
  -- naming a profile that no longer exists.
  if public.row_unchanged_except(to_jsonb(old), to_jsonb(new),
                                 array['closed_by','reopened_by']) then
    return new;
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

create or replace function public.stock_movement_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a stock movement is never deleted — record an adjustment instead';
  end if;

  -- ADDED IN 0075: as above.
  if public.row_unchanged_except(to_jsonb(old), to_jsonb(new),
                                 array['created_by']) then
    return new;
  end if;

  raise exception 'a stock movement is never edited — record an adjustment instead';
end $$;

-- ─── 2. Asset custody has to outlive the holder ─────────────────────────────
-- asset_assignment.employee_id was `not null` with no delete action, so the
-- delete failed outright for anyone who had ever been issued an asset. Custody
-- is an append-only ledger (0060 note 4) and belongs to the "stays" list, so
-- the row keeps its history and remembers the name instead of the person.

alter table public.asset_assignment
  add column if not exists employee_name text not null default '';

update public.asset_assignment s
   set employee_name = p.name
  from public.profiles p
 where p.id = s.employee_id and s.employee_name = '';

alter table public.asset_assignment
  drop constraint if exists asset_assignment_employee_id_fkey;
alter table public.asset_assignment
  alter column employee_id drop not null;
alter table public.asset_assignment
  add constraint asset_assignment_employee_id_fkey
    foreign key (employee_id) references public.profiles(id) on delete set null;

-- Stamped here rather than in the 0061 RPCs, so both issue paths get it and
-- neither has to remember.
create or replace function public.asset_assignment_stamp_employee()
returns trigger language plpgsql set search_path = public as $$
begin
  if btrim(coalesce(new.employee_name, '')) = '' and new.employee_id is not null then
    select name into new.employee_name from public.profiles where id = new.employee_id;
  end if;
  return new;
end $$;

drop trigger if exists asset_assignment_employee_name on public.asset_assignment;
create trigger asset_assignment_employee_name
  before insert on public.asset_assignment
  for each row execute function public.asset_assignment_stamp_employee();

-- The live profile still wins, so a rename shows through; the snapshot is the
-- fallback for a holder who is gone.
create or replace view public.asset_assignment_v as
select
  s.id, s.asset_id,
  a.code as asset_code, a.name as asset_name, a.category as asset_category,
  s.employee_id,
  coalesce(e.name, nullif(s.employee_name, ''), '') as employee_name,
  s.department,
  s.assigned_on, s.returned_on,
  s.returned_on is null as is_open,
  coalesce(ab.name, '') as assigned_by_name,
  coalesce(rb.name, '') as received_by_name,
  s.remarks, s.return_remarks, s.signature_url,
  s.created_at
from public.asset_assignment s
join public.asset a on a.id = s.asset_id
left join public.profiles e  on e.id = s.employee_id
left join public.profiles ab on ab.id = s.assigned_by
left join public.profiles rb on rb.id = s.received_by
where a.deleted_at is null
  and (public.has_perm('assets.view') or s.employee_id = auth.uid());

grant select on public.asset_assignment_v to authenticated;
