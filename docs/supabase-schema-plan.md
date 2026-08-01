# Database Schema Reference — Bakers Theory (bt-store-management)

The consolidated, current-state reference for the Postgres/Supabase backend:
every table, view, RPC, and the privacy model that ties them together — plus the
**why** behind the shape.

> **Source of truth is the ordered SQL in `supabase/migrations/`.** This document
> is the merged, human-readable view of where those 27 migrations have landed. If
> the two ever disagree, the migrations win — and this file needs an update.
> For how the schema fits the app as a whole, see
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) (§8 write path, §9 schema overview).

---

## 1. Design principles

Five decisions were locked in at migration time and still hold:

1. **Auth via Supabase Auth, keyed by a login handle.** Each numeric `userId`
   maps to a synthetic email `<userId>@bt.local`. Supabase stores the password
   and issues real JWT sessions; `profiles` extends `auth.users` with a
   two-value role (`Owner`/`Staff`) plus a `perms text[]` of granular keys.
2. **Single store (not multi-tenant).** One `store_settings` row (`id = 1`);
   items, bills, customers, and users are global.
3. **DB-enforced access control.** Row-Level Security (RLS) on every table is the
   real boundary — never just app checks. The client mirror in
   `src/lib/permissions.ts` only drives UI.
4. **The client never writes a table directly.** Every mutation is a
   `SECURITY DEFINER` RPC that re-checks permission server-side and runs
   atomically. Data tables have **no** client write policy.
5. **`cost_price` is private.** Column-level `SELECT` is revoked from the client
   role; cost is reachable only through definer functions gated on `items.cost`
   / `dashboard.profit` / `reports.export`.

**Extensions:** `pgcrypto` (for `gen_random_uuid()`).

---

## 2. Entity relationships

```mermaid
erDiagram
  AUTH_USERS   ||--|| PROFILES       : "extends (id)"
  PROFILES     ||--o{ BILLS          : "created_by"
  PROFILES     ||--o{ ACTIVITY_LOG   : "actor"
  ITEMS        ||--o{ STOCK_BATCHES  : "item_id (cascade)"
  ITEMS        ||--o{ BILL_ITEMS     : "item_id (set null)"
  ITEMS        ||--o{ ACTIVITY_LOG   : "item_id (set null)"
  BILLS        ||--o{ BILL_ITEMS     : "bill_id (cascade)"
  CUSTOMERS    ||--o{ BILLS          : "customer_id (set null)"
  STORE_SETTINGS {
    int id "singleton = 1"
  }
  STORE_LISTS {
    text kind "category|emoji|unit|reason"
  }
```

`store_settings` and `store_lists` stand alone (no FKs). `bill_items`,
`stock_batches`, `activity_log`, and `bills` snapshot names/prices so a row
survives deletion of the item or user it referenced (`on delete set null`).

---

## 3. Tables

DDL below is the **merged current state** (all migrations applied). Inline
comments flag columns added after `0001`.

### 3.1 `profiles` — users, roles, permissions

Extends `auth.users`. Permissions are a `text[]` of granular keys from the
catalogue in `src/lib/permissions.ts` (`0028`); the stored `role` stays a
two-value flag, because Admin / Manager / Cashier / Storekeeper are **presets
that stamp a permission set**, not stored roles. A partial unique index enforces
**at most one Owner**, who implicitly holds every permission.

```sql
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  user_id        text    not null unique,        -- login handle, e.g. '7873557430'
  name           text    not null,
  role           text    not null default 'Staff' check (role in ('Owner','Staff')),
  perms          text[]  not null default '{}',   -- granular permission keys
  created_at     timestamptz not null default now()
);
create unique index one_owner on public.profiles ((role)) where role = 'Owner';
```

Rows are created automatically: the `handle_new_user` trigger on `auth.users`
copies `user_id` / `name` / `role` / `perms` out of `raw_user_meta_data` (set at
admin-create time; `perms` arrives as a JSON array).

### 3.2 `store_settings` — the singleton

One row, `id = 1`, holding the whole store profile + config. `check (id = 1)`
makes a second row impossible.

```sql
create table public.store_settings (
  id                 int  primary key default 1 check (id = 1),
  name               text not null default 'My Bakery',
  tagline            text not null default '',
  address            text not null default '',
  phone              text not null default '',
  gst                text not null default '',
  logo_url           text,                         -- base64 data URL (via update_logo)
  currency           text not null default '₹',
  tax_rate           numeric not null default 0,
  low_stock_alert    numeric not null default 5,
  updated_at         timestamptz not null default now(),
  expiring_soon_days integer not null default 3,   -- 0011
  is_open            boolean not null default true, -- 0017
  status_changed_at  timestamptz,                   -- 0017
  status_changed_by  text not null default ''       -- 0017: name snapshot
);
-- updated_at maintained by the shared set_updated_at() trigger.
```

### 3.3 `items` — the catalogue

`name_key` is a generated, lowercased/trimmed column with a unique constraint —
this reproduces the original app's "merge duplicate by name" behavior. `qty` is a
**maintained mirror** of `SUM(stock_batches.qty)`, not an independently-written
value (see [§7.1](#71-the-batchfifo-model)).

```sql
create table public.items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_key   text generated always as (lower(trim(name))) stored unique,
  emoji      text not null default '📦',
  category   text not null,
  unit       text not null,
  price      numeric not null default 0,   -- selling price
  cost_price numeric not null default 0,   -- PRIVATE — SELECT revoked (see §5)
  qty        numeric not null default 0,   -- mirror of SUM(batch qty)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tracks_expiry boolean not null default true, -- 0011
  image_url  text                              -- 0022: product image; null = use emoji
);
create index items_category_idx on public.items (category);
-- updated_at maintained by set_updated_at() trigger.
```

### 3.4 `stock_batches` — per-item expiry batches *(0011)*

The source of truth for on-hand quantity. FIFO = soonest expiry first, NULLs last.
`expiry_date IS NULL` means the batch never expires.

```sql
create table public.stock_batches (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  qty         numeric not null,
  expiry_date date,                       -- NULL = never expires
  created_at  timestamptz not null default now()
);
create index stock_batches_item_idx on public.stock_batches (item_id, expiry_date);
```

### 3.5 `bills` — sales headers

`bill_no` comes from a sequence (human-facing invoice number). Money columns are
`numeric(12,2)` (tightened from bare `numeric` in `0014` so fractional-paisa
drift can't be stored). `subtotal` is stored **gross**; tax is charged on the
discounted amount; `total = discounted subtotal + tax`.

```sql
create sequence bill_no_seq start 1001;

create table public.bills (
  id               uuid primary key default gen_random_uuid(),
  bill_no          bigint not null unique default nextval('bill_no_seq'),
  customer_name    text not null default '',
  customer_phone   text not null default '',
  customer_id      uuid references public.customers(id) on delete set null, -- 0009
  subtotal         numeric(12,2) not null,        -- 0014: was numeric
  tax              numeric(12,2) not null,         -- 0014
  total            numeric(12,2) not null,         -- 0014
  tax_rate         numeric not null,
  payment_method   text not null default 'Cash' check (payment_method in ('Cash','UPI')), -- 0007
  discount_percent numeric not null default 0 check (discount_percent between 0 and 100),  -- 0008
  discount_type    text not null default 'percent' check (discount_type in ('percent','flat')), -- 0026
  discount_amount  numeric(12,2) not null default 0, -- 0026: actual ₹ discounted
  status           text not null default 'active' check (status in ('active','cancelled')),
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id) on delete set null,
  cancelled_at     timestamptz,
  cancelled_by     text                            -- name snapshot (survives user deletion)
);
create index bills_created_at_idx  on public.bills (created_at);
create index bills_status_idx      on public.bills (status);
create index bills_customer_id_idx on public.bills (customer_id); -- 0009
```

### 3.6 `bill_items` — sales line items (snapshots)

Lines are stored **relationally with snapshots** — `name` / `emoji` / `unit` /
`price` / `cost_price` / `image_url` are frozen at sale time so a later edit or
deletion of the item never rewrites history.

```sql
create table public.bill_items (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references public.bills(id) on delete cascade,
  item_id    uuid references public.items(id) on delete set null,
  name       text not null,                 -- snapshot
  emoji      text not null default '',       -- snapshot
  unit       text not null,                  -- snapshot
  qty        numeric not null,
  price      numeric not null,               -- snapshot selling price
  cost_price numeric not null default 0,     -- PRIVATE snapshot — SELECT revoked (§5)
  image_url  text                            -- 0022: snapshot of item image at sale time
);
create index bill_items_bill_id_idx on public.bill_items (bill_id);
create index bill_items_item_id_idx on public.bill_items (item_id);
```

### 3.7 `activity_log` — append-only audit trail

One table for every history event. `type` gates which columns are meaningful:
stock moves use `item_*`/`supplier`/`reason`, bill events use
`bill_no`/`items`/`total`, admin events use `notes`. The `check` list has grown
as features shipped.

```sql
create table public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in (
               'in','out','bill','cancel','delete',          -- 0001
               'open','close',                                -- 0017
               'settings','staff_add','staff_edit','staff_remove','password')), -- 0018
  created_at timestamptz not null default now(),
  actor      uuid references public.profiles(id) on delete set null, -- 0003
  -- stock movements
  item_id    uuid references public.items(id) on delete set null,
  item_name  text,
  qty        numeric,
  supplier   text,
  reason     text,
  notes      text,
  -- bill events
  bill_no    bigint,
  items      text,        -- comma-joined item names
  total      numeric
);
create index activity_log_created_at_idx on public.activity_log (created_at desc);
```

### 3.8 `customers` — directory *(0009)*

Identity is `phone`. Visit/spend stats are **computed on read** (see
`customers_with_stats` / `customer_by_phone`), never cached as columns — so
cancellations drop out automatically with zero drift.

```sql
create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique,          -- identity (10-digit)
  name       text not null default '',
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- updated_at maintained by set_updated_at() trigger.
```

### 3.9 `store_lists` — admin-managed option lists *(0006)*

Backs categories / emojis / units / stock-out reasons that used to be hardcoded
in `constants.ts`. Owner-managed via RPCs, readable by any authed user.

```sql
create table public.store_lists (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('category','emoji','unit','reason')),
  value      text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (kind, value)
);
create index store_lists_kind_idx on public.store_lists (kind, sort_order);
```

---

### 3.10 `cash_category` — two-level cashbook categories *(0044)*

Eight `is_system` rows are what the auto-posting paths name by string
(`system_category('Sales')`), so they can be neither renamed nor archived. The
rest are admin-managed on the `store.lists` key, seeded from issue #32's category
table. Removal is `archived_at`, never `DELETE`: a category with entries against
it must keep resolving a label in a historical report forever.

```sql
create table public.cash_category (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.cash_category(id),
  name        text not null,
  direction   text not null default 'out' check (direction in ('in','out','both')),
  is_system   boolean not null default false,
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint cash_category_name_not_blank check (btrim(name) <> ''),
  constraint cash_category_system_is_top_level check (not is_system or parent_id is null)
);
-- TWO partial indexes, not one constraint: Postgres treats NULLs as distinct, so
-- `unique (parent_id, name)` alone would let two top-level groups share a name.
create unique index cash_category_top_name_uniq
  on public.cash_category (name) where parent_id is null;
create unique index cash_category_child_name_uniq
  on public.cash_category (parent_id, name) where parent_id is not null;
create index cash_category_parent_idx on public.cash_category (parent_id, sort_order);
```

`direction` is what stops the expense form offering an income category (and vice
versa) — `add_cash_entry` rejects a mismatch rather than filing it.

**Exactly two levels** is a trigger (`cash_category_depth_guard`), not a CHECK: "my
parent must itself be top-level" reads another row.

---

### 3.11 `cash_entry` — the posting ledger *(0045)*

One row per movement of money in or out of one account. `post_cash` is the only
insert path in the schema; `reverse_cash` is the only correction path.

```sql
create table public.cash_entry (
  id            uuid primary key default gen_random_uuid(),
  on_date       date not null,               -- the LOCAL business date, not created_at
  account       text not null check (account in ('cash','bank')),
  direction     text not null check (direction in ('in','out')),
  amount        numeric(12,2) not null check (amount > 0),  -- sign lives in direction
  payment_mode  text not null check (payment_mode in ('Cash','UPI','Bank Transfer','Cheque')),
  category_id   uuid not null references public.cash_category(id),
  source_type   text not null check (source_type in ('bill','expense','salary',
                  'advance','supplier_payment','manual','transfer','opening')),
  source_id     uuid,                        -- NOT a FK, see below
  reverses_id   uuid references public.cash_entry(id),
  transfer_id   uuid,                        -- pairs the two legs of a transfer
  reference_no  text not null default '',
  note          text not null default '',
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint cash_entry_manual_needs_note
    check (source_type <> 'manual' or btrim(note) <> ''),
  constraint cash_entry_reversal_has_source
    check (reverses_id is null or source_type <> 'opening')
);
```

Three things about this table are load-bearing and easy to "fix" wrongly:

1. **`source_id` is deliberately not a foreign key.** Sources live in five
   different tables, and `delete_bill` hard-deletes its bill while the ledger row
   must survive as history.
2. **`amount` is always positive; the sign lives in `direction`.** Every aggregate
   sums `case when direction = 'in' then amount else -amount end`.
3. **`on_date` is the local business date**, derived with the client's `p_tz` at
   posting time (or `store_settings.timezone` in the backfill) — never
   `created_at::date`.

```sql
-- Makes the 0046 backfill re-runnable. `reverses_id is null` is load-bearing: a
-- reversal shares its original's source_type, source_id AND account, so without
-- it every reversal would collide. `account` is in the key because one Mixed
-- expense (phase C) legitimately posts one row per account.
create unique index cash_entry_source_uniq
  on public.cash_entry (source_type, source_id, account)
  where source_id is not null and reverses_id is null and deleted_at is null;
```

**Immutability** is two triggers on `cash_entry_guard()`, so the guarantee does
not depend on every future RPC remembering to check:

- `DELETE` is refused outright — removal is `deleted_at` (#32's soft-delete rule).
- `UPDATE` is refused when `source_type <> 'manual'`: an auto-posted row mirrors a
  document and is changed by changing the document, which writes a reversal.
- `UPDATE` is refused on the money-shaped columns of a row that already has a
  reversal pointing at it.

Phase B adds a third clause rejecting any row whose `on_date` belongs to a closed
`cash_day`.

---

### 3.12 `expense` — the expense document *(0051)*

An expense is a **document**; the `cash_entry` rows are its **posting** — the same
relationship `purchase_invoice` → `supplier_payment` has. The document carries the
workflow (`pending → paid | rejected`, and `paid → cancelled`) and cash moves only
when it reaches `paid`, through `pay_expense` → `post_cash`.

```sql
create sequence expense_no_seq start 1;

create table public.expense (
  id            uuid primary key default gen_random_uuid(),
  expense_no    bigint not null unique default nextval('expense_no_seq'),
  expense_date  date not null,              -- when the cost was INCURRED
  paid_on       date,                       -- when cash MOVED — what the ledger uses
  category_id   uuid not null references public.cash_category(id),
  vendor_name   text not null default '',
  vendor_supplier_id uuid references public.suppliers(id), -- INFORMATIONAL ONLY
  amount        numeric(12,2) not null check (amount > 0), -- gross, GST inside
  gst_included  boolean not null default false,
  gst_amount    numeric(12,2) not null default 0,          -- the tax component WITHIN amount
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
  deleted_at    timestamptz,                -- removal is soft, per #32
  deleted_by    uuid references public.profiles(id) on delete set null
);
-- updated_at maintained by the shared set_updated_at() trigger (expense_touch).
```

**Seven named check constraints** carry the rules the RPCs would otherwise have to
be trusted with — each rules out a specific bad row:

| Constraint | Rules out |
|---|---|
| `expense_gst_within_amount` — `gst_amount >= 0 and gst_amount < amount` | GST added *on top* of the amount. The tax is inside the gross; the base is derived, never stored. |
| `expense_gst_needs_flag` — `gst_included or gst_amount = 0` | A stray tax figure on a record that claims to have no GST. |
| `expense_mixed_split_adds_up` — non-`Mixed`, or both legs `> 0`, summing to `amount`, with a `split_bank_mode` | A Mixed payment whose two legs don't reconcile to the total, or whose bank leg has no mode for `post_cash` to derive an account from. |
| `expense_single_mode_has_no_split` | Split figures left behind on a record switched back from `Mixed` to a single mode. |
| `expense_paid_needs_date_and_approver` | A `paid` expense with no `paid_on` (the ledger would have no date) or no `approved_by`. |
| `expense_reject_needs_reason` | An unexplained rejection. |
| `expense_cancel_needs_reason` | An unexplained cancellation — which reversed real cash. |

**Six indexes**, five of them partial on `deleted_at is null` because a removed
expense is never listed:

```sql
create index expense_date_idx     on public.expense (expense_date desc, expense_no desc)
  where deleted_at is null;                                   -- the default register order
create index expense_status_idx   on public.expense (status, expense_date desc)
  where deleted_at is null;                                   -- the pending queue
create index expense_category_idx on public.expense (category_id) where deleted_at is null;
create index expense_vendor_idx   on public.expense (lower(vendor_name))
  where deleted_at is null;                                   -- vendor filter + expense_vendors()
create index expense_supplier_idx on public.expense (vendor_supplier_id)
  where vendor_supplier_id is not null;                       -- the supplier page's "Other expenses"
-- NOT unique, deliberately.
create index expense_invoice_idx  on public.expense (lower(invoice_no))
  where btrim(invoice_no) <> '';
```

`expense_invoice_idx` is **not** unique on purpose. #32 asks for a duplicate
*warning*, and one supplier invoice legitimately splits across two expense
records. The index exists to make the client's on-blur lookup cheap, not to block
the insert.

Two more things about this table are load-bearing:

1. **`paid_on`, not `expense_date`, is the ledger date.** An invoice dated 28 Jul
   and paid on 31 Jul must hit the 31 Jul cash book or the drawer will not
   reconcile. `assert_cash_day_open` therefore guards `paid_on`; reports group by
   `expense_date`.
2. **`vendor_supplier_id` is a firewall, not a join into payables.**
   `supplier_summary_v` is computed from posted invoices, payments and credit
   notes only, and nothing in `0051`/`0052` touches it. A linked expense shows on
   the supplier page as a separate *Other expenses* line and never reduces what is
   owed.

### 3.13 `expense_event` — the approval and edit history *(0051)*

One row per state change, plus a field-level `jsonb` diff on every edit — the same
`detail` shape `/api/staff/route.ts` already writes. Every path writes through the
single internal `log_expense_event`, so none can skip history.

```sql
create table public.expense_event (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expense(id) on delete cascade,
  event      text not null check (event in ('created','edited','approved','rejected',
                                            'paid','cancelled','deleted')),
  actor      uuid references public.profiles(id) on delete set null,
  at         timestamptz not null default now(),
  detail     jsonb not null default '{}'::jsonb  -- diff for `edited`; reason for reject/cancel
);
create index expense_event_expense_idx on public.expense_event (expense_id, at);
```

Both tables have RLS enabled with a **select-only** policy on
`has_perm('expense.view')`. There is no client write policy at all — writes are
reachable only through the `0052` definer RPCs. `activity_log.type` is widened to
accept `'expense'` in `0051`, so every event is mirrored into the Activity page
and needs no second audit surface.

---

## 4. Views (the read surface)

The client reads `*_v` views, not base tables, wherever a view exists. They join
in derived fields and re-gate visibility. All are `SECURITY DEFINER` (default),
so they can read revoked/other-user columns and expose them only per the `where`
clause.

| View | Adds / does | Visibility gate |
|---|---|---|
| `items_v` | Appends `tracks_expiry`, `earliest_expiry`, `batches` (jsonb, in-stock only, FIFO-ordered), `image_url`; returns `cost_price` **only** to `items.cost` / `dashboard.profit` holders (else `null`). | `SELECT` granted to `authenticated`; cost masked per-row. |
| `bills_v` | `b.* + biller_name` (joined from `profiles.created_by`). | `bill.history`, `bill.create`, `dashboard.view` or `reports.view`. |
| `activity_log_v` | Log rows + `actor_name` (joined from `profiles`). | `has_perm('activity.view')`. |
| `activity_log_admin_v` | Same shape as `activity_log_v`, but **only** admin event types (`open`/`close`/`settings`/`staff_*`/`password`). | `is_owner()` — returns zero rows to non-owners. |
| `expense_v` *(0051)* | The expense document + `category_name` / `category_group` / `category_path` (`Group › Category`), `vendor_display` (a **linked supplier's name wins** over the typed one, so the vendor-wise report gets one identity), and `paid_by_name` / `approved_by_name` / `created_by_name` / `updated_by_name`. Excludes soft-deleted rows. | `has_perm('expense.view')`. |
| `expense_event_v` *(0051)* | History rows + `actor_name` (joined from `profiles`); `detail` passes through as jsonb. | `has_perm('expense.view')`. |

> `CREATE OR REPLACE VIEW` can only **append** columns, never reorder. Later
> migrations add columns at the end; the client reads with `select *` and maps by
> name, so order is irrelevant. `bills_v` uses `b.*`, which is frozen at creation
> — so adding a `bills` column requires a `drop view` + recreate (see `0026`).

---

## 5. Column privacy & grants

RLS is row-level and cannot hide a *column*. To make `cost_price` private:

```sql
-- 0002: drop the table-level SELECT, grant every column EXCEPT cost_price.
revoke select on public.items      from anon, authenticated;
grant  select (id, name, name_key, emoji, category, unit, price, qty,
               created_at, updated_at, tracks_expiry, image_url)
       on public.items to authenticated;

revoke select on public.bill_items from anon, authenticated;
grant  select (id, bill_id, item_id, name, emoji, unit, qty, price, image_url)
       on public.bill_items to authenticated;
```

Consequences that must be respected:

- **Never `select *` on `items` / `bill_items`** from the client — it errors on
  the revoked `cost_price` for non-privileged roles. Read `items_v` (cost masked)
  or list columns explicitly.
- **Cost reaches analytics only through gated definer functions:**
  `bill_lines_with_cost()` checks `dashboard.profit` / `reports.export`, and
  `dashboard_stats(...)` returns COGS as `null` without `dashboard.profit`.
- **The client type has no cost field to leak into** — mappers hard-code
  `costPrice: 0` on bill lines.
- **Adding a readable column requires a matching grant.** `0022` added
  `bill_items.image_url` but forgot the grant; `0024` fixed it (without it, direct
  `bill_items` reads returned zero rows for historical bills).

---

## 6. RPC catalog

Every mutation is a `SECURITY DEFINER` function that (1) re-checks permission,
(2) for inventory ops also calls `assert_store_open()` (non-owners are blocked
while the store is closed — `0019`), (3) runs atomically, (4) returns the affected
row for cache-patching or `void`. All are `grant execute … to authenticated`
unless marked *internal*.

### Helpers (RLS / guards)

| Function | Returns | Purpose |
|---|---|---|
| `my_role()` | `text` | Caller's role from `profiles`. |
| `is_owner()` | `boolean` | `my_role() = 'Owner'`. |
| `has_perm(perm text)` | `boolean` | Owner ⇒ true; else `perm = any(perms)`. Also resolves the three legacy group keys (`sales` / `inventory` / `analytics`) as "holds any permission in that area", so pre-`0028` policies keep working. |
| `assert_store_open()` | `void` | *internal* — raises if store closed (Owner exempt). |
| `set_updated_at()` | trigger | *internal* — shared `updated_at` bump. |
| `handle_new_user()` | trigger | *internal* — creates a `profiles` row from `auth.users` metadata. |
| `attendance_roster()` | `table` | Names of everyone attendance can be recorded against (`attendance.view`). |
| `set_attendance(...)` | `attendance_v` | Upsert one employee-day (`attendance.edit`); rejects future dates in the caller's tz. |
| `clear_attendance(...)` | `void` | Remove one employee-day (`attendance.edit`). |
| `attendance_summary(...)` | `table` | Per-employee status tallies + `payable_days` (`attendance.view`). |
| `attendance_tally(from, to)` | `table` | *internal* — the status weights in one place (`payable_days` + `unpaid_days`). Deliberately NOT permission-gated and revoked from public, so payroll can read tallies without `attendance.view`. |
| `employee_salaries()` | `table` | Roster with monthly salary (`salary.view`). |
| `set_employee_salary(...)` | `void` | Upsert one salary (`salary.edit`). |
| `payroll_compute(gross, days, unpaid)` | `table` | *internal* — deduction + net; rounds the deduction first so `gross − deduction = net` exactly. |
| `payroll_preview(year, month)` | `table` | The month's payroll recomputed from live attendance (`salary.view`). |
| `save_salary_payment(...)` | `salary_payment_v` | Create/adjust a period; refuses a period already paid (`salary.edit`). |
| `mark_salary_paid(...)` / `mark_salary_unpaid(...)` | `salary_payment_v` | Record or reverse a payment (`salary.pay`). |
| `delete_salary_payment(id)` | `void` | Unpaid records only (`salary.edit`). |

### Items & inventory — gate: one key each (+ store-open)

`create_item` → `items.create` · `update_item` / `set_item_image` → `items.edit` ·
`delete_item` → `items.delete` · `stock_in` → `stock.in` · `stock_out` →
`stock.out` · `write_off_batch` / `update_batch_expiry` → `stock.expiry`.
`update_item` writes `cost_price` only for `items.cost` holders — otherwise it
leaves the stored cost untouched, since the view hands them `null`.

| Function | Returns | Purpose |
|---|---|---|
| `create_item(p jsonb)` | `jsonb` (`kind` + full `items_v` row) | Add, or merge-by-`name_key`; seeds an initial batch. |
| `update_item(p_id uuid, p jsonb)` | `items_v` | Edit fields + `tracks_expiry`; **never** writes `qty`. Untracking collapses batches into one non-expiring batch. |
| `delete_item(p_id uuid)` | `void` | Delete (cascades batches). |
| `set_item_image(p_id uuid, p_url text)` | `items_v` | Persist/clear one item's image without touching other fields (`0023`). |
| `stock_in(p_item, p_qty, p_supplier, p_notes, p_expiry date)` | `items_v` | Add a batch (merges same expiry) + log `in`. |
| `stock_out(p_item, p_qty, p_reason, p_notes)` | `items_v` | FIFO-consume (incl. expired) + log `out`. |
| `write_off_batch(p_batch_id uuid)` | `items_v` | Delete one batch (e.g. expired) + log `out`. |
| `update_batch_expiry(p_batch_id, p_expiry date)` | `items_v` | Correct a best-before date; qty untouched (`0012`). |

*Internal batch helpers* (revoked from `public`, called only inside the above):
`add_batch(item, qty, expiry)`, `consume_fifo(item, qty)`,
`consume_fresh_fifo(item, qty, tz)` — see [§7.1](#71-the-batchfifo-model).

### Bills — gate: `sales`

| Function | Returns | Purpose |
|---|---|---|
| `generate_bill(customer jsonb, lines jsonb, p_tz text = 'UTC')` | `bills` | The core transaction — see [§7.2](#72-generate_bill-anatomy). Blocked when the store is closed. |
| `cancel_bill(p_id uuid, p_by text)` | `void` | Flip to `cancelled`, restore stock as a non-expiring batch, log `cancel`. |
| `delete_bill(p_id uuid, p_by text)` | `void` | Hard-delete (cascades lines); restores stock only if the bill was still active. Logs `delete`. |

### Customers — gate: `sales` | `inventory`

| Function | Returns | Purpose |
|---|---|---|
| `customers_with_stats()` | `table` | Directory + visit/spend/last-purchase from **active** bills. |
| `customer_by_phone(p_phone text)` | `table` | Indexed single-customer lookup for checkout autofill (cheaper than the full directory). |
| `update_customer(p_id, p_name, p_phone)` | `customers` | Correct a name/phone typed at billing; unique-phone enforced. |

### Store / settings — gate: `Owner` (`is_owner()`)

| Function | Returns | Purpose |
|---|---|---|
| `save_settings(p jsonb)` | `void` | Update the singleton; logs a `settings` event. |
| `update_logo(p_url text)` | `void` | Set `logo_url`. |
| `set_store_status(p_open boolean, p_by text)` | `void` | Open/close the store; records who/when + logs `open`/`close`. |
| `clear_all_data()` | `void` | Wipe bills/batches/items/log, restart `bill_no_seq` at 1001. |
| `log_password_change()` | `void` | *(any authed user)* record a `password` event after a self password change. |

### Lists — gate: `Owner`

| Function | Returns | Purpose |
|---|---|---|
| `add_list_value(p_kind text, p_value text)` | `void` | Append a category/emoji/unit/reason. |
| `delete_list_value(p_id uuid)` | `void` | Remove one; refuses if a category/unit is still in use. |

### Analytics / cost-gated reads — gate: `analytics`

| Function | Returns | Purpose |
|---|---|---|
| `bill_lines_with_cost()` | `table` (incl. `cost_price`) | Cost-bearing bill lines for the Excel COGS/profit export; empty for non-analytics. |
| `dashboard_stats(p_tz text = 'UTC', p_from date = null, p_to date = null)` | `jsonb` | Server-side KPI aggregation for a local-day range, with a previous-period comparison. `cogs` is `null` for non-analytics users. |

### Expenses *(0052)* — gate: one `expense.*` key each

`save_expense` → `expense.create` · `pay_expense` / `reject_expense` →
`expense.pay` · `cancel_expense` / `delete_expense` → `expense.cancel` ·
`expense_vendors` → `expense.view`. There is no separate `expense.delete` key:
deletion is only reachable for a record that never moved money, and the authority
to void an expense is the same authority.

| Function | Returns | Purpose |
|---|---|---|
| `save_expense(p jsonb)` | `uuid` | Create a `pending` expense, or edit one. Validates the amount, the not-in-the-future `expenseDate`, the GST-inside-the-amount rule, the Mixed split and its bank mode, and that the category is a non-system, money-out **leaf** (`is_leaf_category`). An edit writes a field-level diff; a save that changed nothing writes no history. |
| `pay_expense(p_id uuid, p_paid_on date, p_mode text, p_split_cash numeric = 0, p_split_bank numeric = 0, p_split_bank_mode text = '')` | `void` | Approve **and** pay in one action. Sets `status = 'paid'`, `paid_on`, `approved_by`, then posts the cash. The mode arguments let an approver pay by a different method than was proposed. |
| `reject_expense(p_id uuid, p_reason text)` | `void` | A `pending` expense we are not paying. **No money moves.** The reason is required. |
| `cancel_expense(p_id uuid, p_reason text)` | `void` | A **paid** expense that shouldn't have been. Calls `reverse_cash('expense', id, reason)`, which reverses *both* legs of a Mixed payment; if the paid day is closed the reversals land on the current open day (`0049`) rather than rewriting a counted one. The reason is required. |
| `delete_expense(p_id uuid)` | `void` | Soft-delete (`deleted_at`), and only for a `pending` or `rejected` record. A `paid` or `cancelled` one is history and refuses. |
| `expense_vendors()` | `setof text` | Distinct past vendor names for the form's autocomplete — mitigates `BESCOM` vs `Bescom` drift without a vendor master, which would be a second payables system. |
| `log_expense_event(p_expense_id uuid, p_event text, p_detail jsonb = '{}')` | `void` | *internal* — the single writer of `expense_event`, `revoke execute … from public` so no path can bypass history. |

Three mechanics a reader would otherwise have to reverse-engineer:

1. **The one-step path is `save_expense` calling `pay_expense`.** When the payload
   carries `payNow`, `save_expense` **re-checks `expense.pay`** before delegating —
   holding `expense.create` alone raises *"you can record this expense but not pay
   it — it needs approval"* and the record stays `pending`.
2. **`pay_expense` guards `paid_on`, not `expense_date`,** with
   `assert_cash_day_open` — so a payment cannot be backdated into a closed day even
   though the invoice itself may be dated inside one. A `Mixed` payment posts
   **two** `post_cash` rows, one per account, sharing the expense's `source_id`;
   this is why `cash_entry_source_uniq` keys on `account`.
3. **An edit is allowed to the creator *or* any `expense.pay` holder,** so an
   approver can fix a mis-picked category without bouncing the record back. Only a
   `pending` expense is editable at all — a `paid` one has moved money and is
   cancelled and re-recorded instead.

---

## 7. Deep dives

### 7.1 The batch / FIFO model

Before `0011`, `items.qty` was the authoritative quantity. `0011` made
`stock_batches` the source of truth and demoted `items.qty` to a **mirror**
(`SUM(batch.qty)`), recomputed by the batch helpers after every change. Existing
stock was backfilled as one non-expiring batch per item.

- **`add_batch(item, qty, expiry)`** — merges into the batch with the same
  `expiry_date` (NULL merges into the single non-expiring batch), else inserts;
  then refreshes `items.qty`. Forces `expiry = NULL` when the item doesn't track
  expiry.
- **`consume_fifo(item, qty)`** — draws down batches ordered
  `expiry_date asc nulls last, created_at asc`, clamped at 0 (never negative),
  deletes emptied batches, refreshes `items.qty`. Used by **manual** `stock_out`
  (which may legitimately target expired stock).
- **`consume_fresh_fifo(item, qty, tz)`** *(0020)* — same, but **skips batches
  whose `expiry_date < today`** (today computed in the client's `tz`). Used by
  `generate_bill` so a sale can never silently deduct expired stock.

`items_v.batches` exposes only in-stock (`qty > 0`) batches, FIFO-ordered, as
jsonb — but **includes expired ones**; the bill page filters those out locally so
it sells/shows only fresh stock. Cancel/delete restore returns stock as a
**non-expiring** batch (the originally-consumed batches are unrecoverable).

### 7.2 `generate_bill` anatomy

The one function where several invariants meet. Current signature:
`generate_bill(customer jsonb, lines jsonb, p_tz text default 'UTC')`. In order:

1. **Gate:** `has_perm('bill.create')` (plus `bill.discount` when the payload
   carries a discount), then reject if the store is closed.
2. **Price pass:** loop `lines`, `select … for update` each item (row-lock against
   concurrent stock changes), sum `qty * price` → `subtotal` (rounded to 2dp).
3. **Customer upsert:** only when a phone is present (`0010` made phone optional —
   phone-less = anonymous walk-in, `customer_id` stays NULL). Upsert by phone,
   keep the latest non-empty name, bump `last_seen`.
4. **Discount + tax:** `discount_type` selects percent (clamp 0–100) or flat
   (clamp ₹-off to subtotal); tax is charged on the **discounted** taxable amount;
   every step rounded to 2dp (`0014`).
5. **Insert** the `bills` row (payment method, both discount representations,
   `created_by = auth.uid()`).
6. **Line pass:** insert each `bill_items` snapshot (incl. `image_url`) and
   `consume_fresh_fifo` its quantity.
7. **Log** a `bill` activity row and return the new `bills` row.

The whole thing is one transaction — a failure anywhere rolls back stock,
customer, bill, and log together.

### 7.3 Local-day ↔ UTC

`timestamptz` columns are filtered by the **user's** calendar day, not the
server's. `dashboard_stats` and `generate_bill` take an IANA `p_tz` and decide
day boundaries / batch freshness server-side; the client passes the same tz and
converts local `YYYY-MM-DD` to UTC instants for history filters and the Excel
export. This must stay consistent across dashboard, history, billing, and export.

---

## 8. Migration history

`0001` init (tables, RLS, helpers, core RPCs) · `0002` cost privacy + logo ·
`0003` activity-log actor view · `0004` dashboard stats · `0005` bill-line cost id ·
`0006` store_lists · `0007` payment method · `0008` percent discount ·
`0009` customers · `0010` optional customer phone · `0011` stock batches ·
`0012` edit batch expiry · `0013` biller-name view · `0014` round bill totals +
`numeric(12,2)` · `0015` customer-by-phone lookup · `0016` mutations return the item
row · `0017` store open/closed status · `0018` store/staff admin audit +
admin view · `0019` closed store blocks inventory · `0020` bills skip expired
batches · `0021` dashboard stats by range · `0022`/`0023` product images ·
`0024` grant `bill_items.image_url` · `0025` dashboard prev-period counts ·
`0026` flat discount · `0027` update customer.

Apply in order via the Supabase SQL editor or `supabase db push`.

---

## 9. Conventions for changing the schema

1. **New numbered migration** — never edit a shipped one. Reproduce the current
   function body and change only what's needed (later files do this verbatim; the
   header comment says which prior version it's based on).
2. **A new mutation is a new RPC** — `SECURITY DEFINER`, permission check first,
   `assert_store_open()` if it's an inventory op, atomic body, return the affected
   row for cache-patching. Then add the `rpc*` wrapper in
   `lib/supabase-data.ts` and the store action.
3. **Changing an RPC's argument list** requires `drop function` first (overloads
   are ambiguous otherwise). Same signature ⇒ `create or replace` needs no re-grant.
4. **A new readable column** on `items`/`bill_items` needs an explicit column
   `grant` (unless it's cost-sensitive). Surfacing it on a `b.*` view (`bills_v`)
   needs a `drop view` + recreate.
5. **Never expose `cost_price`** to the client role — route any cost-aware feature
   through an analytics-gated definer function.
6. **Keep the catalogue in `permissions.ts` in sync** with the SQL policy/helper model — but
   remember RLS is the boundary, not the client mirror.
```