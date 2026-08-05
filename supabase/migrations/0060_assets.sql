-- ============================================================================
-- BT Store Management — the asset register (#91, module 1 of 2)
--
--   1. AN ASSET IS NEVER DELETED. #91 §7 asks for soft delete only, so removal
--      is `deleted_at` and retirement is a terminal *status*. `archived_at` is a
--      third, weaker state: out of the active list, still not deleted. All three
--      survive in reports and in the audit trail.
--   2. STATUS IS SYSTEM-OWNED, NOT A FORM FIELD. save_asset (0061) never writes
--      it; only the assign/return/transfer/repair/mark RPCs do, and every one of
--      them goes through assert_asset_transition(). The lifecycle in §2.3 is a
--      table in SQL, mirrored by `src/lib/asset.ts` for the UI.
--   3. LEAVING `assigned` ALWAYS CLOSES THE OPEN ASSIGNMENT. Sending an asset
--      for repair, or marking it lost, damaged or retired while someone holds it,
--      writes `returned_on` on the open custody row rather than orphaning it —
--      which is why the two check constraints below can insist that `assigned_to`
--      is set exactly when the status is `assigned`.
--   4. CUSTODY IS AN APPEND-ONLY LEDGER. asset_assignment rows are never
--      overwritten or deleted (§2.5); a return closes a row, a transfer closes
--      one and opens the next. A partial unique index makes "at most one open
--      assignment per asset" a database guarantee rather than an RPC promise.
--   5. CATEGORIES LIVE IN store_lists, NOT IN AN ENUM. §2.1 wants them
--      admin-configurable, and this app already has an admin-managed list table
--      with a UI (0006). A new `asset_category` kind beats a new master table.
--      Vendors are `public.suppliers` for the same reason.
--   6. THERE IS NO DEPARTMENT TABLE IN THIS APP, so `department` is text — a
--      snapshot on the asset and again on each assignment row (§2.5 asks for the
--      snapshot explicitly). A reference would need a master this product has no
--      other use for.
--   7. NO barcode COLUMN. §2.2 wants a QR label "generated on demand" — it
--      encodes `code`, which every asset already has and which never changes.
--      Storing a second identifier would let the two disagree.
--   8. A STAFF MEMBER SEES THEIR OWN KIT WITHOUT assets.view. §4.5 gives Staff
--      "view own assigned assets", so the read policy is
--      `has_perm('assets.view') OR assigned_to = auth.uid()`.
-- ============================================================================

-- ─── Audit log: the two new entry types ─────────────────────────────────────
-- Widen only, and idempotently — the same shape as 0029, 0030, 0035 and 0051.
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and conname = 'activity_log_type_check';

  if v_def is null or v_def not like '%consumable%' then
    alter table public.activity_log drop constraint if exists activity_log_type_check;
    alter table public.activity_log add constraint activity_log_type_check
      check (type in ('in','out','bill','cancel','delete','open','close',
                      'settings','staff_add','staff_edit','staff_remove','password',
                      'attendance','salary','salary_pay','advance','advance_pay',
                      'supplier','purchase','purchase_pay','purchase_return',
                      'cashbook','expense','asset','consumable'));
  end if;
end $ck$;

-- ─── store_lists: the asset category list (note 5) ──────────────────────────
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.store_lists'::regclass
    and conname = 'store_lists_kind_check';

  if v_def is null or v_def not like '%asset_category%' then
    alter table public.store_lists drop constraint if exists store_lists_kind_check;
    alter table public.store_lists add constraint store_lists_kind_check
      check (kind in ('category','emoji','unit','reason','asset_category'));
  end if;
end $ck$;

insert into public.store_lists (kind, value, sort_order) values
  ('asset_category','Electronics',0),
  ('asset_category','Kitchen equipment',1),
  ('asset_category','Furniture',2),
  ('asset_category','Appliances',3),
  ('asset_category','Vehicles',4),
  ('asset_category','Tools',5),
  ('asset_category','Others',6)
on conflict (kind, value) do nothing;

-- ─── Human-quotable id, the same shape as suppliers.code ────────────────────
create sequence if not exists asset_code_seq start 1;

create table if not exists public.asset (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique
                    default 'AST-' || lpad(nextval('asset_code_seq')::text, 4, '0'),

  name            text not null check (btrim(name) <> ''),
  category        text not null check (btrim(category) <> ''),
  brand           text not null default '',
  model           text not null default '',
  serial_number   text not null default '',

  purchase_date   date not null,
  purchase_price  numeric(12,2) not null check (purchase_price >= 0),
  vendor_id       uuid references public.suppliers(id),

  warranty_start  date,
  warranty_expiry date,

  location        text not null check (btrim(location) <> ''),
  -- Note 6: text, not a reference.
  department      text not null default '',

  -- Note 3: set exactly when status = 'assigned'.
  assigned_to     uuid references public.profiles(id) on delete set null,

  -- Note 2: system-owned. No RPC lets a form write this.
  status          text not null default 'available'
                    check (status in ('available','assigned','under_repair',
                                      'maintenance','lost','damaged','retired')),
  condition       text not null default ''
                    check (condition in ('','new','good','fair','poor')),

  notes           text not null default '',
  image_url       text,
  -- §2.2 allows several purchase documents. `[{"name":…,"url":…}]`.
  documents       jsonb not null default '[]'::jsonb,

  -- Both maintained by close_asset_maintenance (0061), never typed in.
  last_service_date date,
  next_service_date date,

  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid references public.profiles(id) on delete set null,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id) on delete set null,

  -- §7: "dates logical". A warranty cannot end before it starts, and cannot end
  -- before the thing was bought.
  constraint asset_warranty_order
    check (warranty_start is null or warranty_expiry is null
           or warranty_expiry >= warranty_start),
  constraint asset_warranty_after_purchase
    check (warranty_expiry is null or warranty_expiry >= purchase_date),
  constraint asset_service_after_purchase
    check (last_service_date is null or last_service_date >= purchase_date),

  -- Note 3, both directions.
  constraint asset_assigned_has_holder
    check (status <> 'assigned' or assigned_to is not null),
  constraint asset_unassigned_has_no_holder
    check (status = 'assigned' or assigned_to is null),

  constraint asset_documents_is_array
    check (jsonb_typeof(documents) = 'array')
);

-- §2.2: unique *if provided*. Two assets with no serial are not duplicates, and
-- a deleted one must not block re-registering the same machine.
create unique index if not exists asset_serial_uniq
  on public.asset (lower(btrim(serial_number)))
  where btrim(serial_number) <> '' and deleted_at is null;

-- §7 asks for indexes on the columns the register actually filters by.
create index if not exists asset_status_idx
  on public.asset (status, name) where deleted_at is null;
create index if not exists asset_category_idx
  on public.asset (category) where deleted_at is null;
create index if not exists asset_holder_idx
  on public.asset (assigned_to) where deleted_at is null and assigned_to is not null;
create index if not exists asset_service_due_idx
  on public.asset (next_service_date)
  where deleted_at is null and next_service_date is not null;
create index if not exists asset_warranty_idx
  on public.asset (warranty_expiry)
  where deleted_at is null and warranty_expiry is not null;
create index if not exists asset_name_idx
  on public.asset (lower(name)) where deleted_at is null;
create index if not exists asset_vendor_idx
  on public.asset (vendor_id) where vendor_id is not null;

drop trigger if exists asset_touch on public.asset;
create trigger asset_touch before update on public.asset
  for each row execute function public.set_updated_at();

-- ─── Custody: append-only (note 4) ──────────────────────────────────────────
create table if not exists public.asset_assignment (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references public.asset(id),
  employee_id    uuid not null references public.profiles(id),
  -- Snapshot at the time of assignment (§2.5), not a live join.
  department     text not null default '',

  assigned_on    date not null,
  returned_on    date,

  assigned_by    uuid references public.profiles(id) on delete set null,
  -- The confirming employee, when that is someone other than the holder.
  received_by    uuid references public.profiles(id) on delete set null,

  remarks        text not null default '',
  return_remarks text not null default '',
  -- §2.5's digital signature: a Storage URL, captured by the UI.
  signature_url  text,

  created_at     timestamptz not null default now(),

  constraint asset_assignment_return_after_issue
    check (returned_on is null or returned_on >= assigned_on)
);

-- Note 4: at most one open custody row per asset, enforced by the database.
create unique index if not exists asset_assignment_one_open
  on public.asset_assignment (asset_id) where returned_on is null;
create index if not exists asset_assignment_asset_idx
  on public.asset_assignment (asset_id, assigned_on desc);
create index if not exists asset_assignment_employee_idx
  on public.asset_assignment (employee_id, assigned_on desc);

-- ─── Maintenance & service (§2.6) ───────────────────────────────────────────
create table if not exists public.asset_maintenance (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references public.asset(id),

  -- `repair` is unplanned, `service` is scheduled, `amc` is a contract.
  kind          text not null check (kind in ('repair','service','amc')),
  status        text not null default 'open' check (status in ('open','closed')),

  vendor_id     uuid references public.suppliers(id),

  scheduled_on  date,
  started_on    date not null,
  completed_on  date,

  cost          numeric(12,2) not null default 0 check (cost >= 0),

  -- AMC details (§2.6). Only meaningful for kind = 'amc'.
  amc_start     date,
  amc_end       date,
  amc_ref       text not null default '',

  -- What close_asset_maintenance copies onto asset.next_service_date.
  next_service_on date,

  notes         text not null default '',

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),

  constraint asset_maintenance_closed_has_date
    check (status <> 'closed' or completed_on is not null),
  constraint asset_maintenance_complete_after_start
    check (completed_on is null or completed_on >= started_on),
  constraint asset_maintenance_amc_order
    check (amc_start is null or amc_end is null or amc_end >= amc_start)
);

-- An asset is either in the workshop or it is not; two open jobs would make
-- "return it to available" ambiguous.
create unique index if not exists asset_maintenance_one_open
  on public.asset_maintenance (asset_id) where status = 'open';
create index if not exists asset_maintenance_asset_idx
  on public.asset_maintenance (asset_id, started_on desc);
create index if not exists asset_maintenance_vendor_idx
  on public.asset_maintenance (vendor_id) where vendor_id is not null;
create index if not exists asset_maintenance_due_idx
  on public.asset_maintenance (next_service_on)
  where next_service_on is not null;

drop trigger if exists asset_maintenance_touch on public.asset_maintenance;
create trigger asset_maintenance_touch before update on public.asset_maintenance
  for each row execute function public.set_updated_at();

-- ─── The timeline (§2.4 "View Asset History") ───────────────────────────────
-- One row per thing that happened, written by every 0061 RPC. The same shape as
-- expense_event (0051), so the detail page needs no second audit surface.
create table if not exists public.asset_event (
  id       uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.asset(id) on delete cascade,
  event    text not null
             check (event in ('created','edited','assigned','returned',
                              'transferred','status_changed','maintenance_opened',
                              'maintenance_closed','archived','restored','deleted')),
  actor    uuid references public.profiles(id) on delete set null,
  at       timestamptz not null default now(),
  detail   jsonb not null default '{}'::jsonb
);

create index if not exists asset_event_asset_idx
  on public.asset_event (asset_id, at);

-- ─── RLS: read per note 8; every write goes through an 0061 RPC ─────────────
alter table public.asset enable row level security;
drop policy if exists asset_read on public.asset;
create policy asset_read on public.asset for select
  using (public.has_perm('assets.view') or assigned_to = auth.uid());

alter table public.asset_assignment enable row level security;
drop policy if exists asset_assignment_read on public.asset_assignment;
create policy asset_assignment_read on public.asset_assignment for select
  using (public.has_perm('assets.view') or employee_id = auth.uid());

alter table public.asset_maintenance enable row level security;
drop policy if exists asset_maintenance_read on public.asset_maintenance;
create policy asset_maintenance_read on public.asset_maintenance for select
  using (public.has_perm('assets.view'));

alter table public.asset_event enable row level security;
drop policy if exists asset_event_read on public.asset_event;
create policy asset_event_read on public.asset_event for select
  using (public.has_perm('assets.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
-- `*_days_left` are computed against store_today() rather than the client's
-- clock, the same rule the cashbook follows: the store's calendar decides what
-- "due" means, and a view cannot take the client's timezone as an argument.
create or replace view public.asset_v as
select
  a.id, a.code, a.name, a.category, a.brand, a.model, a.serial_number,
  a.purchase_date, a.purchase_price,
  a.vendor_id,
  coalesce(v.name, '') as vendor_name,
  a.warranty_start, a.warranty_expiry,
  a.location, a.department,
  a.assigned_to,
  coalesce(h.name, '') as assigned_to_name,
  a.status, a.condition, a.notes, a.image_url, a.documents,
  a.last_service_date, a.next_service_date,

  -- The open custody row, so the detail page needs no second query.
  oa.id           as open_assignment_id,
  oa.assigned_on  as assigned_on,
  -- The open workshop job, likewise.
  om.id           as open_maintenance_id,
  om.kind         as open_maintenance_kind,

  (a.warranty_expiry - public.store_today())  as warranty_days_left,
  (a.next_service_date - public.store_today()) as service_days_left,

  a.archived_at is not null as is_archived,
  a.archived_at,
  a.created_at,
  coalesce(cb.name, '') as created_by_name,
  a.updated_at,
  coalesce(ub.name, '') as updated_by_name
from public.asset a
left join public.suppliers v on v.id = a.vendor_id
left join public.profiles  h on h.id = a.assigned_to
left join public.profiles cb on cb.id = a.created_by
left join public.profiles ub on ub.id = a.updated_by
left join public.asset_assignment oa
       on oa.asset_id = a.id and oa.returned_on is null
left join public.asset_maintenance om
       on om.asset_id = a.id and om.status = 'open'
where a.deleted_at is null
  and (public.has_perm('assets.view') or a.assigned_to = auth.uid());

create or replace view public.asset_assignment_v as
select
  s.id, s.asset_id,
  a.code as asset_code, a.name as asset_name, a.category as asset_category,
  s.employee_id,
  coalesce(e.name, '') as employee_name,
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

create or replace view public.asset_maintenance_v as
select
  m.id, m.asset_id,
  a.code as asset_code, a.name as asset_name, a.category as asset_category,
  m.kind, m.status,
  m.vendor_id,
  coalesce(v.name, '') as vendor_name,
  m.scheduled_on, m.started_on, m.completed_on,
  m.cost,
  m.amc_start, m.amc_end, m.amc_ref,
  m.next_service_on,
  m.notes,
  coalesce(cb.name, '') as created_by_name,
  m.created_at, m.updated_at
from public.asset_maintenance m
join public.asset a on a.id = m.asset_id
left join public.suppliers v on v.id = m.vendor_id
left join public.profiles cb on cb.id = m.created_by
where a.deleted_at is null
  and public.has_perm('assets.view');

create or replace view public.asset_event_v as
select ev.id, ev.asset_id, ev.event, ev.at, ev.detail,
       coalesce(p.name, '') as actor_name
from public.asset_event ev
left join public.profiles p on p.id = ev.actor
where public.has_perm('assets.view');

grant select on public.asset_v to authenticated;
grant select on public.asset_assignment_v to authenticated;
grant select on public.asset_maintenance_v to authenticated;
grant select on public.asset_event_v to authenticated;
