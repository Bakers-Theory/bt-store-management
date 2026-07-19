# Onboarding — Bakers Theory

Welcome. This doc gets you from "just cloned the repo" to "confidently making
changes." It's a runbook, not a reference — for the deep *why* of any subsystem,
follow the links into **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

Read time: ~20 minutes. Setup time: ~30 minutes (mostly Supabase).

---

## 1. The 5-minute mental model

Bakers Theory is a **single-store bakery app** (inventory, billing, receipts,
customers, analytics) — a mobile-first PWA built on **Next.js 14 + TypeScript +
Tailwind + Zustand**, backed by **Supabase** (Postgres + Auth + RLS + RPCs).

Internalize this one rule and most of the codebase makes sense:

> **The browser is never trusted.** The client *reads* tables (Row-Level Security
> decides what it can see) but **never writes** them directly. Every change goes
> through a Postgres `SECURITY DEFINER` function (an "RPC") that re-checks
> permissions and does the write atomically.

So a typical action is a three-part story you'll see over and over:

```
UI component  →  store action (lib/store.ts)  →  rpc wrapper (lib/supabase-data.ts)  →  SQL function (supabase/migrations)
```

Two Zustand stores hold client state: `useBakeryStore` (data: settings, items,
lists) and `useUIStore` (transient: toasts, print, owner-password gate).

---

## 2. Prerequisites

- **Node 20** (CI uses 20).
- **pnpm 9** — this repo's lockfile is `pnpm-lock.yaml` and CI installs with
  `pnpm install --frozen-lockfile`. (There is also a `package-lock.json`; prefer
  pnpm to match CI.)
- A **Supabase project** you can run migrations against (a free project is fine).
- The **Supabase CLI** (optional but handy for `supabase db push`).

---

## 3. Local setup, step by step

### 3.1 Install

```bash
pnpm install
```

### 3.2 Environment

Create `.env.local` in the repo root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>   # SERVER ONLY — never shipped to the client
```

> ⚠️ The service-role key **bypasses RLS**. It's used only by the server (the
> staff API route and the seed script). Never import it into client code, never
> expose it with a `NEXT_PUBLIC_` prefix.

### 3.3 Apply the database schema

Run every file in `supabase/migrations/` **in numeric order** — via the Supabase
SQL editor, or:

```bash
supabase db push
```

These create the tables, RLS policies, the `SECURITY DEFINER` RPCs, and the `*_v`
views the client reads from.

### 3.4 Seed the Owner (once)

There's exactly one Owner account, created with the admin/service-role key. Set
these in `.env.local`, then run the seed script:

```bash
# OWNER_USER_ID / OWNER_NAME / OWNER_PASSWORD must be set in .env.local first
node --env-file=.env.local scripts/seed-owner.mjs
```

### 3.5 Run

```bash
pnpm dev          # http://localhost:3000
```

Log in with the **User ID handle** you seeded (e.g. `7873557430`) and its
password. Behind the scenes that handle maps to a Supabase Auth email
`<handle>@bt.local` — see `lib/auth.ts`. The Owner can then create staff (with
per-area permissions) under **Settings → Staff & data → Manage Users**.

### 3.6 The other scripts

```bash
pnpm test         # Vitest — the logic-layer suite
pnpm run typecheck
pnpm run lint
pnpm run build
```

CI runs `lint`, `typecheck`, and `test` on deploy — get all three green locally
before opening a PR.

---

## 4. Guided tour — where everything lives

Application code is under `src/`. Start with these, in this order:

1. **`src/lib/types.ts`** — the domain vocabulary (`Item`, `Bill`, `Customer`,
   `User`, `Permissions`, …). Read this first; every other file speaks in these
   types.
2. **`src/lib/store.ts`** — the data store and **all write actions**. This is the
   spine of the client.
3. **`src/lib/supabase-data.ts`** — every read (fetchers + mappers) and every RPC
   wrapper. The only place that talks to Supabase.
4. **`src/lib/permissions.ts`** — who can see/do what, on the client (nav + route
   guards). Its server-side twin is `is_owner()` / `has_perm()` in the SQL.
5. **`src/app/(app)/layout.tsx`** + **`src/components/system/AuthProvider.tsx`** —
   how auth resolves and the app boots.
6. **`src/components/feature/<section>/`** — one folder per screen (dashboard,
   stock, bill, history, customers, settings). The `"use client"` UI.
7. **`supabase/migrations/`** — the schema and the RPCs, in order.

Everything else (charts, Excel, formatting, expiry, image handling) lives as
small pure modules in `src/lib/` with `*.test.ts` siblings.

For the full directory map and the reasoning behind the layout, see
[ARCHITECTURE §4](./ARCHITECTURE.md#4-directory-layout).

---

## 5. How to make a change (worked examples)

These follow the grain of the codebase. Copy the shape of the nearest existing
example.

### 5.1 Add a field to an existing screen (read-only)

Say you want to show a new column that already exists in the DB.

1. Add it to the row interface + mapper in `lib/supabase-data.ts`.
2. Add it to the app type in `lib/types.ts`.
3. Render it in the relevant `components/feature/*` component.

No migration needed if the column and its `*_v` view already expose it. (If the
column is currently not selected by a view, you'll need a migration to add it —
and if it's a *sensitive* column, see the cost-price pattern before exposing it.)

### 5.2 Add a new mutation (the common case)

Everything that writes needs all three layers. Example — imagine adding
"archive item":

1. **Migration** (`supabase/migrations/00NN_archive_item.sql`): a
   `SECURITY DEFINER` function that (a) checks permission first
   (`if not public.has_perm('inventory') then raise exception 'forbidden'`),
   (b) does the write atomically, (c) returns the affected `items_v` row so the
   client can patch its cache, and (d) `grant execute … to authenticated`.
   Model it on `stock_out` / `update_item` in `0001_init.sql`.
2. **RPC wrapper** in `lib/supabase-data.ts`: `export const rpcArchiveItem = (id)
   => rpc<ItemRow>("archive_item", { p_id: id })` (map the row with `mapItem`).
3. **Store action** in `lib/store.ts`: call the wrapper, then reconcile the cache
   (`patchItem(...)` for single-item ops, `refreshItems()` for multi-item ops).
4. **UI**: call the store action from the feature component; surface success/
   failure with `toast(...)`.

> Rule of thumb: **if it writes, it's a migration + a wrapper + a store action.**
> The client must never `insert`/`update`/`delete` a table directly.

### 5.3 Change permissions or navigation

- **UI behavior** (which nav items show, which routes are reachable, the landing
  route): edit `lib/permissions.ts` (`navItems`, `canAccessSection`,
  `defaultRoute`) — and update its test.
- **Actual enforcement**: the SQL RLS policies and the `has_perm()` checks inside
  the RPCs. **Changing `permissions.ts` alone changes nothing about security** —
  it only decides what to render. Always change both sides together and keep them
  consistent. See
  [ARCHITECTURE §2](./ARCHITECTURE.md#2-the-one-idea-that-explains-everything).

### 5.4 Change money math

Edit `lib/bill.ts` and update `lib/bill.test.ts`. Because it's pure, prove the
change with a test before wiring it into the UI.

### 5.5 Add an admin-managed option (category, unit, etc.)

Those aren't hardcoded — they live in the `store_lists` table and the Owner edits
them under **Settings → Store → Item options**. Read `groupLists` in
`supabase-data.ts` and the `add_list_value` / `delete_list_value` RPCs.

---

## 6. Conventions & gotchas (read before your first PR)

- **Follow the surrounding style.** Utility-first Tailwind in the JSX; only
  heavily-repeated primitives are `@layer components` classes in `globals.css`.
  Keep changes surgical — don't refactor adjacent code you weren't asked to.
- **Timezones are explicit.** `timestamptz` columns are filtered by the *user's*
  calendar day, not the server's. Use `dayStartISO`/`dayEndISO` and pass the
  client tz to `dashboard_stats` / `generate_bill`. If you add a date filter,
  convert local→UTC the same way. See
  [ARCHITECTURE §7](./ARCHITECTURE.md#7-data-access--libsupabase-datats).
- **Postgres `bigint`/`numeric` arrive as strings** over the wire — coerce with
  `Number()` in mappers (see `mapCustomer`).
- **`cost_price` is private.** It's revoked from the client role at the column
  level. Never `select` it directly; any cost-aware feature goes through an
  analytics-gated RPC. Client bill-line mappers hard-code `costPrice: 0`.
- **Don't put the `AuthProvider` `onAuthStateChange` callback to sleep.** Keep it
  synchronous — awaiting a DB call inside it can deadlock the auth lock and leave
  the app on a blank screen. Profile fetching happens in a separate effect.
- **Only base data is cached.** `useBakeryStore` persists `{ bakery, items,
  lists }` to `localStorage`. Never persist bills, dashboard data, or actions.
- **New Supabase reads should hit the `*_v` view** when one exists, not the base
  table.
- **Migrations are append-only and numbered.** Add `00NN_description.sql`; never
  edit an already-applied migration.

---

## 7. Testing & quality gates

`pnpm test` runs Vitest (jsdom) over `src/lib/**/*.test.ts` — the pure logic
layer: permissions/routing, bill math, analytics aggregation, Excel report
assembly (cancelled bills excluded), and the `store_lists` → app-shape mapper.

There are no component/e2e tests; the logic layer is where correctness is
proven. When you touch `lib/*` logic, add or update its test. The deploy pipeline
runs `lint` + `typecheck` + `test` and won't ship a red build.

---

## 8. Shipping

Deployment is decoupled from pushing to `main`:

1. Merge your PR to `main` (nothing deploys yet).
2. Run the **Release** workflow (`.github/workflows/release.yml`) via
   `workflow_dispatch`, choosing patch/minor/major. It computes the version +
   notes and cuts a GitHub Release.
3. Publishing that Release triggers **Deploy** (`.github/workflows/deploy.yml`):
   lint/typecheck/test, then a prebuilt Vercel CLI deploy to production.

So: **cutting a release is what promotes to production.** Details in
[ARCHITECTURE §13](./ARCHITECTURE.md#13-build-ci--deploy).

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **RPC** | A Postgres `SECURITY DEFINER` function called via `supabase.rpc(...)`. All writes go through these. |
| **RLS** | Row-Level Security — Postgres policies deciding which rows a role can read. |
| **`*_v` view** | The read surface the client selects from (`items_v`, `bills_v`, …) — joins/derives fields and scopes rows. |
| **Base data** | Settings + items + option lists — the bounded, cached-in-`localStorage` client state. |
| **Owner / Staff** | The two roles. Exactly one Owner; Staff have per-area (sales/inventory/analytics) permissions. |
| **User ID handle** | The numeric login (e.g. `7873557430`), mapped to `<handle>@bt.local` for Supabase Auth. |
| **System host** | A render-null component mounted once in the root layout (`AuthProvider`, `ToastHost`, `PrintHost`, …). |
| **Batch** | A per-item stock lot with an expiry date; bills consume FIFO and skip expired lots. |

---

## 10. Your first day checklist

- [ ] Repo cloned, `pnpm install` done.
- [ ] `.env.local` filled in (all three keys).
- [ ] Migrations applied to a Supabase project.
- [ ] Owner seeded; you can log in.
- [ ] `pnpm dev` runs; you can create an item and generate a bill.
- [ ] `pnpm test`, `pnpm run typecheck`, `pnpm run lint` all green.
- [ ] Read [ARCHITECTURE §2](./ARCHITECTURE.md#2-the-one-idea-that-explains-everything)
      and §5–§8 (auth, state, data access, the write path).
- [ ] Skim `types.ts`, `store.ts`, `supabase-data.ts`, and `0001_init.sql`.

When those are done, you're ready to pick up a ticket.
