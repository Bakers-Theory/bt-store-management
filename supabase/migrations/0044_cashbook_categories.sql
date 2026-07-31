-- ============================================================================
-- BT Store Management — cashbook categories and the store timezone (Phase A)
--
--   1. THE STORE HAS A TIMEZONE NOW. Postgres `current_date` is the SERVER's
--      UTC date, which is the wrong day for an Indian store between 00:00 and
--      05:30 IST. Live posting paths (generate_bill) already receive p_tz from
--      the client, but cancel_bill / delete_bill / mark_salary_unpaid do not and
--      cannot without changing their client signatures. One stored timezone
--      settles "what is today" for every path.
--   2. CATEGORIES ARE TWO LEVELS, and postings always reference a LEAF. "Has no
--      children" is a cross-row aggregate, so it is a trigger in 0045, not a
--      CHECK here.
--   3. SYSTEM CATEGORIES ARE UNDELETABLE. Auto-posted entries name them, so an
--      admin archiving one would break the posting path. They are top-level and
--      childless, which makes them leaves and therefore valid posting targets.
--   4. ARCHIVE, NEVER DELETE. A category with entries against it must keep
--      resolving in a historical report forever.
-- ============================================================================

-- ─── The store's calendar ───────────────────────────────────────────────────
alter table public.store_settings
  add column if not exists timezone text not null default 'Asia/Kolkata';

-- Every "is this today?" question in the cashbook goes through here.
create or replace function public.store_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone (select timezone from public.store_settings where id = 1))::date
$$;
revoke execute on function public.store_today() from public;
grant execute on function public.store_today() to authenticated;

-- ─── Audit log: the cashbook entry type ─────────────────────────────────────
-- Widen only, and idempotently — the same shape as 0029, 0030, 0032 and 0035.
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and conname = 'activity_log_type_check';

  if v_def is null or v_def not like '%cashbook%' then
    alter table public.activity_log drop constraint if exists activity_log_type_check;
    alter table public.activity_log add constraint activity_log_type_check
      check (type in ('in','out','bill','cancel','delete','open','close',
                      'settings','staff_add','staff_edit','staff_remove','password',
                      'attendance','salary','salary_pay','advance','advance_pay',
                      'supplier','purchase','purchase_pay','purchase_return',
                      'cashbook'));
  end if;
end $ck$;

-- ─── Categories ─────────────────────────────────────────────────────────────
create table if not exists public.cash_category (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.cash_category(id),
  name        text not null,
  direction   text not null default 'out'
                check (direction in ('in','out','both')),
  is_system   boolean not null default false,
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint cash_category_name_not_blank check (btrim(name) <> ''),
  -- A system category is a top-level, childless posting target.
  constraint cash_category_system_is_top_level
    check (not is_system or parent_id is null)
);

-- Postgres treats NULLs as distinct, so one unique constraint would let two
-- top-level groups share a name. Two partial indexes are the fix.
create unique index if not exists cash_category_top_name_uniq
  on public.cash_category (name) where parent_id is null;
create unique index if not exists cash_category_child_name_uniq
  on public.cash_category (parent_id, name) where parent_id is not null;
create index if not exists cash_category_parent_idx
  on public.cash_category (parent_id, sort_order);

-- Exactly two levels: a child's parent must itself be top-level.
create or replace function public.cash_category_depth_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'a category cannot be its own parent';
    end if;
    if exists (select 1 from public.cash_category
                where id = new.parent_id and parent_id is not null) then
      raise exception 'categories are only two levels deep';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cash_category_depth on public.cash_category;
create trigger cash_category_depth
  before insert or update on public.cash_category
  for each row execute function public.cash_category_depth_guard();

-- ─── Seed ───────────────────────────────────────────────────────────────────
-- System categories: what the auto-posting paths name. Top-level and childless,
-- so they are valid leaves.
insert into public.cash_category (name, direction, is_system, sort_order) values
  ('Sales',            'in',   true, 0),
  ('Sales Reversal',   'out',  true, 1),
  ('Refund',           'both', true, 2),
  ('Salary',           'out',  true, 3),
  ('Staff Advance',    'out',  true, 4),
  ('Supplier Payment', 'out',  true, 5),
  ('Opening Balance',  'both', true, 6),
  ('Transfer',         'both', true, 7)
on conflict do nothing;

-- User categories: #32's tree. `Employee → Salary` is deliberately absent —
-- payroll auto-posts to the system Salary category, and a duplicate user
-- category would split every report.
with groups as (
  insert into public.cash_category (name, direction, sort_order) values
    ('Raw Materials', 'out', 10),
    ('Packaging',     'out', 11),
    ('Office',        'out', 12),
    ('Utilities',     'out', 13),
    ('Employee',      'out', 14),
    ('Maintenance',   'out', 15),
    ('Marketing',     'out', 16),
    ('Transport',     'out', 17),
    ('Other',         'both', 18)
  on conflict do nothing
  returning id, name
), leaves (parent, name, direction, ord) as (
  values
    ('Raw Materials','Milk','out',0), ('Raw Materials','Cream','out',1),
    ('Raw Materials','Butter','out',2), ('Raw Materials','Cheese','out',3),
    ('Raw Materials','Chocolate','out',4), ('Raw Materials','Sugar','out',5),
    ('Raw Materials','Flour','out',6), ('Raw Materials','Eggs','out',7),
    ('Raw Materials','Yeast','out',8),
    ('Packaging','Cake Boxes','out',0), ('Packaging','Pastry Boxes','out',1),
    ('Packaging','Paper Bags','out',2), ('Packaging','Carry Bags','out',3),
    ('Packaging','Stickers','out',4), ('Packaging','Labels','out',5),
    ('Office','Printer Ink','out',0), ('Office','Stationery','out',1),
    ('Office','Internet','out',2), ('Office','Phone Bill','out',3),
    ('Utilities','Electricity','out',0), ('Utilities','Water','out',1),
    ('Utilities','Gas','out',2), ('Utilities','Rent','out',3),
    ('Employee','Bonus','out',0), ('Employee','Staff Meal','out',1),
    ('Employee','Uniform','out',2),
    ('Maintenance','Equipment Repair','out',0), ('Maintenance','Cleaning','out',1),
    ('Maintenance','Pest Control','out',2),
    ('Marketing','Facebook Ads','out',0), ('Marketing','Instagram Ads','out',1),
    ('Marketing','Google Ads','out',2), ('Marketing','Printing','out',3),
    ('Transport','Fuel','out',0), ('Transport','Courier','out',1),
    ('Transport','Vehicle Maintenance','out',2),
    ('Other','Petty Cash','out',0), ('Other','Adjustment','both',1),
    ('Other','Other Income','in',2), ('Other','Owner Drawings','out',3),
    ('Other','Miscellaneous','both',4)
)
insert into public.cash_category (parent_id, name, direction, sort_order)
select g.id, l.name, l.direction, l.ord
from leaves l
join public.cash_category g on g.name = l.parent and g.parent_id is null
on conflict do nothing;

-- ─── RLS: read with cashbook.view; writes only via the RPCs below ────────────
alter table public.cash_category enable row level security;
drop policy if exists cash_category_read on public.cash_category;
create policy cash_category_read on public.cash_category for select
  using (public.has_perm('cashbook.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
create or replace view public.cash_category_v as
select c.id, c.parent_id, c.name, c.direction, c.is_system, c.sort_order,
       coalesce(p.name, '') as parent_name,
       case when p.name is null then c.name else p.name || ' › ' || c.name end as path,
       not exists (select 1 from public.cash_category k
                    where k.parent_id = c.id and k.archived_at is null) as is_leaf
from public.cash_category c
left join public.cash_category p on p.id = c.parent_id
where c.archived_at is null
  and public.has_perm('cashbook.view');

grant select on public.cash_category_v to authenticated;

-- ─── RPCs ───────────────────────────────────────────────────────────────────
-- Gated on store.lists, the existing key for admin-managed option lists.
create or replace function public.add_cash_category(
  p_parent_id uuid, p_name text, p_direction text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_next int;
begin
  if not public.has_perm('store.lists') then raise exception 'forbidden'; end if;
  if v_name = '' then raise exception 'a category needs a name'; end if;
  if p_direction not in ('in','out','both') then
    raise exception 'a category must be income, expense or both';
  end if;
  if p_parent_id is not null then
    if not exists (select 1 from public.cash_category
                    where id = p_parent_id and archived_at is null) then
      raise exception 'that category group no longer exists';
    end if;
    -- Adding a child to a category that already has postings would silently
    -- turn a posted-against leaf into a group. Refused outright.
    if exists (select 1 from public.cash_entry where category_id = p_parent_id) then
      raise exception
        'entries are already filed under "%" — it cannot become a group',
        (select name from public.cash_category where id = p_parent_id);
    end if;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.cash_category
  where parent_id is not distinct from p_parent_id;

  insert into public.cash_category (parent_id, name, direction, sort_order)
    values (p_parent_id, v_name, p_direction, v_next);

  insert into public.activity_log (type, actor, item_name, notes)
    values ('cashbook', auth.uid(), v_name, 'Added a cashbook category');
end $$;

create or replace function public.archive_cash_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.cash_category;
begin
  if not public.has_perm('store.lists') then raise exception 'forbidden'; end if;
  select * into v from public.cash_category where id = p_id;
  if not found then raise exception 'category not found'; end if;
  if v.is_system then
    raise exception '"%" is built in and cannot be removed', v.name;
  end if;
  if v.archived_at is not null then raise exception 'already archived'; end if;
  if exists (select 1 from public.cash_category
              where parent_id = p_id and archived_at is null) then
    raise exception 'remove the categories inside "%" first', v.name;
  end if;

  -- Archived, never deleted: historical entries must keep resolving a label.
  update public.cash_category set archived_at = now() where id = p_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('cashbook', auth.uid(), v.name, 'Archived a cashbook category');
end $$;

grant execute on function public.add_cash_category(uuid, text, text) to authenticated;
grant execute on function public.archive_cash_category(uuid) to authenticated;
