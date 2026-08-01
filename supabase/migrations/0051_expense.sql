-- ============================================================================
-- BT Store Management — the expense document (Phase C)
--
--   1. AN EXPENSE IS A DOCUMENT; A cash_entry IS ITS POSTING. Cash moves only
--      when the expense reaches `paid`. The same relationship purchase_invoice
--      → supplier_payment already has (0037, 0038).
--   2. expense_date IS WHEN THE COST WAS INCURRED; paid_on IS WHEN CASH MOVED.
--      The LEDGER uses paid_on — an invoice dated 28 Jul paid on 31 Jul must hit
--      the 31 Jul cash book or the drawer will not reconcile. Reports group by
--      expense_date.
--   3. amount IS GROSS AND GST IS INSIDE IT. gst_amount is the tax component
--      within amount, never added on top: the cash that left is `amount`,
--      because the tax was paid too. The base is derived, never stored.
--   4. A MIXED PAYMENT NEEDS A BANK-LEG MODE. post_cash derives the account
--      from the mode, so the two legs must name different modes. The cash leg is
--      always 'Cash'; split_bank_mode says whether the other half was UPI or a
--      bank transfer. Defaulting it would misfile a UPI payment.
--   5. THE SUPPLIER LINK IS INFORMATIONAL AND NOTHING MORE. supplier_summary_v
--      is computed from posted invoices, payments and credit notes only. Nothing
--      in this migration or 0052 touches it. An expense against a supplier does
--      NOT reduce what is owed them.
--   6. invoice_no IS NOT UNIQUE. #32 asks for a duplicate WARNING; one supplier
--      invoice legitimately splits across two expense records. The index exists
--      to make the client's lookup cheap, not to block.
-- ============================================================================

-- ─── Audit log: the expense entry type ──────────────────────────────────────
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and conname = 'activity_log_type_check';

  if v_def is null or v_def not like '%expense%' then
    alter table public.activity_log drop constraint if exists activity_log_type_check;
    alter table public.activity_log add constraint activity_log_type_check
      check (type in ('in','out','bill','cancel','delete','open','close',
                      'settings','staff_add','staff_edit','staff_remove','password',
                      'attendance','salary','salary_pay','advance','advance_pay',
                      'supplier','purchase','purchase_pay','purchase_return',
                      'cashbook','expense'));
  end if;
end $ck$;

-- ─── Human-quotable id, the same shape as bills.bill_no ─────────────────────
create sequence if not exists expense_no_seq start 1;

create table if not exists public.expense (
  id            uuid primary key default gen_random_uuid(),
  expense_no    bigint not null unique default nextval('expense_no_seq'),

  expense_date  date not null,
  paid_on       date,

  category_id   uuid not null references public.cash_category(id),

  vendor_name   text not null default '',
  -- Informational only. Note 5 above.
  vendor_supplier_id uuid references public.suppliers(id),

  amount        numeric(12,2) not null check (amount > 0),
  gst_included  boolean not null default false,
  gst_amount    numeric(12,2) not null default 0,

  payment_mode  text not null
                  check (payment_mode in ('Cash','UPI','Bank Transfer','Mixed')),
  split_cash    numeric(12,2) not null default 0,
  split_bank    numeric(12,2) not null default 0,
  split_bank_mode text not null default ''
                  check (split_bank_mode in ('','UPI','Bank Transfer')),

  invoice_no    text not null default '',
  description   text not null default '',

  paid_by       uuid references public.profiles(id) on delete set null,
  approved_by   uuid references public.profiles(id) on delete set null,

  status        text not null default 'pending'
                  check (status in ('pending','paid','rejected','cancelled')),
  reject_reason text not null default '',
  cancel_reason text not null default '',

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id) on delete set null,

  -- GST is inside the amount, so it can never equal or exceed it, and it is zero
  -- unless the flag says otherwise.
  constraint expense_gst_within_amount
    check (gst_amount >= 0 and gst_amount < amount),
  constraint expense_gst_needs_flag
    check (gst_included or gst_amount = 0),

  -- The Mixed contract, both directions. Note 4 above.
  constraint expense_mixed_split_adds_up
    check (payment_mode <> 'Mixed'
           or (split_cash > 0 and split_bank > 0
               and round(split_cash + split_bank, 2) = round(amount, 2)
               and split_bank_mode <> '')),
  constraint expense_single_mode_has_no_split
    check (payment_mode = 'Mixed'
           or (split_cash = 0 and split_bank = 0 and split_bank_mode = '')),

  -- The workflow, carried by the table rather than trusted to the RPC.
  constraint expense_paid_needs_date_and_approver
    check (status <> 'paid' or (paid_on is not null and approved_by is not null)),
  constraint expense_reject_needs_reason
    check (status <> 'rejected' or btrim(reject_reason) <> ''),
  constraint expense_cancel_needs_reason
    check (status <> 'cancelled' or btrim(cancel_reason) <> '')
);

create index if not exists expense_date_idx
  on public.expense (expense_date desc, expense_no desc) where deleted_at is null;
create index if not exists expense_status_idx
  on public.expense (status, expense_date desc) where deleted_at is null;
create index if not exists expense_category_idx
  on public.expense (category_id) where deleted_at is null;
create index if not exists expense_vendor_idx
  on public.expense (lower(vendor_name)) where deleted_at is null;
create index if not exists expense_supplier_idx
  on public.expense (vendor_supplier_id) where vendor_supplier_id is not null;
-- NOT unique. Note 6 above.
create index if not exists expense_invoice_idx
  on public.expense (lower(invoice_no)) where btrim(invoice_no) <> '';

drop trigger if exists expense_touch on public.expense;
create trigger expense_touch before update on public.expense
  for each row execute function public.set_updated_at();

-- ─── The approval and edit history ──────────────────────────────────────────
create table if not exists public.expense_event (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expense(id) on delete cascade,
  event      text not null
               check (event in ('created','edited','approved','rejected',
                                'paid','cancelled','deleted')),
  actor      uuid references public.profiles(id) on delete set null,
  at         timestamptz not null default now(),
  -- Field-level diff for `edited`; the reason for `rejected`/`cancelled`. The
  -- same shape /api/staff/route.ts already writes.
  detail     jsonb not null default '{}'::jsonb
);

create index if not exists expense_event_expense_idx
  on public.expense_event (expense_id, at);

-- ─── RLS: read with expense.view; writes only via the 0052 RPCs ─────────────
alter table public.expense enable row level security;
drop policy if exists expense_read on public.expense;
create policy expense_read on public.expense for select
  using (public.has_perm('expense.view'));

alter table public.expense_event enable row level security;
drop policy if exists expense_event_read on public.expense_event;
create policy expense_event_read on public.expense_event for select
  using (public.has_perm('expense.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
create or replace view public.expense_v as
select
  e.id, e.expense_no, e.expense_date, e.paid_on,
  e.category_id,
  c.name as category_name,
  coalesce(pc.name, '') as category_group,
  case when pc.name is null then c.name else pc.name || ' › ' || c.name end
    as category_path,
  e.vendor_name, e.vendor_supplier_id,
  -- A linked supplier's name wins, so the vendor-wise report gets one identity.
  coalesce(nullif(s.name, ''), e.vendor_name) as vendor_display,
  e.amount, e.gst_included, e.gst_amount,
  e.payment_mode, e.split_cash, e.split_bank, e.split_bank_mode,
  e.invoice_no, e.description,
  -- The id as well as the name: the register filters by who paid, and a filter
  -- cannot run against a column the view does not project.
  e.paid_by,
  coalesce(pb.name, '') as paid_by_name,
  coalesce(ab.name, '') as approved_by_name,
  e.status, e.reject_reason, e.cancel_reason,
  e.created_by,
  coalesce(cb.name, '') as created_by_name,
  e.created_at,
  coalesce(ub.name, '') as updated_by_name,
  e.updated_at
from public.expense e
join public.cash_category c on c.id = e.category_id
left join public.cash_category pc on pc.id = c.parent_id
left join public.suppliers s on s.id = e.vendor_supplier_id
left join public.profiles pb on pb.id = e.paid_by
left join public.profiles ab on ab.id = e.approved_by
left join public.profiles cb on cb.id = e.created_by
left join public.profiles ub on ub.id = e.updated_by
where e.deleted_at is null
  and public.has_perm('expense.view');

create or replace view public.expense_event_v as
select ev.id, ev.expense_id, ev.event, ev.at, ev.detail,
       coalesce(p.name, '') as actor_name
from public.expense_event ev
left join public.profiles p on p.id = ev.actor
where public.has_perm('expense.view');

grant select on public.expense_v to authenticated;
grant select on public.expense_event_v to authenticated;
