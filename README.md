# Bakers Theory — Next.js

A bakery management app (inventory, billing, receipts, analytics) built as an
idiomatic **Next.js 14 (App Router) + TypeScript + Tailwind + Zustand** project,
backed by **Supabase** (Postgres, Auth, Row-Level Security, and RPCs).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

For production:

```bash
npm run build
npm start
```

Other scripts:

```bash
npm test        # Vitest logic-layer suite
npm run typecheck
npm run lint
```

## Supabase setup

The app needs a Supabase project. Create `.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>   # server-only, never shipped to the client
```

1. **Apply the schema.** Run each file in `supabase/migrations/` (in order) via
   the Supabase SQL editor or `supabase db push`. These create the tables,
   RLS policies, and the `SECURITY DEFINER` RPCs that all writes go through.
2. **Seed the Owner.** The single Owner account is created once with the
   admin/service-role key:

   ```bash
   # set OWNER_USER_ID / OWNER_NAME / OWNER_PASSWORD in .env.local first
   node --env-file=.env.local scripts/seed-owner.mjs
   ```

## Login

Users log in with a **User ID handle** (e.g. `7873557430`), which maps to a
Supabase Auth email `<handle>@bt.local`. The Owner (seeded above) can create
staff users with per-area permissions (Sales, Inventory, Analytics) under
**Settings → Staff & data → Manage Users**.

## Architecture

This app was rewritten from an original single-file vanilla-JS app (global
`state`, `innerHTML` rendering, inline `onclick`) into real React, then moved
from browser-local storage to a Supabase backend.

Application code lives under the optional **`src/`** directory (the convention
documented in the Next.js project-structure guide), keeping the repo root for
config. Everything is on the **App Router** — no `pages/` directory.

- **`src/app/`** — App Router routes. `src/app/(app)/` is an authenticated group
  whose layout guards the session (via Supabase) and renders the top bar +
  bottom nav; `login/` sits outside it. Routes: `/dashboard`, `/stock`, `/bill`,
  `/history`, `/settings`. The route pages are **server components** that compose
  the interactive client components below.
- **`src/utils/supabase/`** — the `@supabase/ssr` clients: `client.ts` (browser),
  `server.ts` (server components / route handlers), `middleware.ts` (session
  refresh), and `admin.ts` (service-role, server-only).
- **`src/lib/store.ts`** — the single **Zustand** store holding bakery settings,
  the item catalogue and the option lists. It is **not** persisted to
  `localStorage`; `load()` hydrates it from Supabase via `fetchBaseData()` and is
  re-run after every mutation. Bills/logs are not cached here — the dashboard
  reads server-side aggregates and History paginates.
- **`src/lib/supabase-data.ts`** — all data access: fetchers (base data,
  dashboard stats, paginated bills/logs, report export) and the RPC wrappers.
  Every write is a Postgres `SECURITY DEFINER` RPC that re-checks permissions
  server-side (`is_owner()` / `has_perm()`), so the client never mutates tables
  directly.
- **`src/lib/ui-store.ts`** — transient UI slices (toasts, the owner-password
  gate, and thermal-receipt printing), surfaced by the hosts in
  `src/components/system/`.
- **`src/lib/`** — pure, unit-tested logic: `permissions`, `bill` (totals),
  `analytics`, `excel` (multi-sheet report assembly), `format`, and the
  `groupLists` list mapper.
- **`src/components/feature/`** — one folder per section (dashboard, stock, bill,
  history, settings). These are the `"use client"` boundary.
- **`supabase/migrations/`** — the DB schema: profiles + RLS helpers, store
  settings, items, bills, activity log, dashboard-stats RPC, and the
  `store_lists` option table (below).
- **`src/app/globals.css`** — Tailwind **v4** entry (`@import "tailwindcss"`)
  with a CSS-first `@theme` block defining the palette/shadow/font tokens (so
  utilities like `bg-brown`, `text-ink-muted` exist). Styling is **utility-first
  in the JSX**; only heavily-repeated primitives (buttons, cards, badges, form
  atoms) and the thermal receipt are kept as `@layer components` classes. The
  `@media print` block also lives here.
- **`xlsx`** is an npm dependency, dynamically imported only when a report is
  generated (kept out of the main bundle).

## Admin-managed item options

Item categories, icon emojis, units, and stock-out reasons are **not
hardcoded** — they live in the `store_lists` table and are edited by the Owner
under **Settings → Store → Item options** (add via a text input, remove via the
chip's ✕). Removing a category or unit still assigned to an item is blocked.
The Settings page is split into two tabs: **Store** (bakery profile + item
options) and **Staff & data** (staff/permissions, password, reports, and the
data danger zone).

## Tests

`npm test` runs the Vitest suite over the logic layer: permissions/routing,
bill math, analytics aggregation, the Excel report assembly (cancelled bills
excluded from aggregates), and the `store_lists` → app-shape list mapper.

## Security

Auth, authorization, and data all live in Supabase, not the browser:

- **Supabase Auth** manages sessions (no plaintext passwords in app storage).
- **Row-Level Security** governs every table; the client role can only read what
  its permissions allow, and all writes go through permission-checked
  `SECURITY DEFINER` RPCs.
- **Cost columns** (`items.cost_price`, `bill_items.cost_price`) are revoked from
  the client role and exposed only to analytics-permitted users via a gated RPC.
- The **service-role key** is server-only (used by `src/utils/supabase/admin.ts`
  and the seed script) and must never be shipped to the client.
