# Bakers Theory — Next.js

A bakery management app (inventory, billing, receipts, analytics) built as an
idiomatic **Next.js 14 (App Router) + TypeScript + Tailwind + Zustand** project.

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

## Default login

A fixed **Owner** account is always seeded:

- **User ID:** `7873557430`
- **Password:** `Dominar@400`

The Owner can create staff users with per-area permissions (Sales, Inventory,
Analytics) under **Settings → Manage Users**.

## Architecture

This app was rewritten from an original single-file vanilla-JS app (global
`state`, `innerHTML` rendering, inline `onclick`) into real React.

Application code lives under the optional **`src/`** directory (the convention
documented in the Next.js project-structure guide), keeping the repo root for
config. Everything is on the **App Router** — no `pages/` directory.

- **`src/app/`** — App Router routes. `src/app/(app)/` is an authenticated group
  whose layout guards the session and renders the top bar + bottom nav; `login/`
  sits outside it. Routes: `/dashboard`, `/stock`, `/bill`, `/history`,
  `/settings`. The route pages are **server components** that compose the
  interactive client components below.
- **`src/lib/store.ts`** — the single **Zustand** store (persisted to
  `localStorage` via the `persist` middleware) holding bakery settings, items,
  bills, logs and users, with every domain action (login, save/delete item,
  stock in/out, generate/cancel/delete bill, user CRUD, settings). Hydration is
  triggered explicitly from `src/components/system/StoreHydrator.tsx` to avoid
  SSR mismatch.
- **`src/lib/ui-store.ts`** — transient UI slices (toasts, the owner-password
  gate, and thermal-receipt printing), surfaced by the hosts in
  `src/components/system/`.
- **`src/lib/`** — pure, unit-tested logic: `permissions`, `bill` (totals),
  `excel` (6-sheet report assembly), `format`, `constants`.
- **`src/components/feature/`** — one folder per section (dashboard, stock, bill,
  history, settings) plus shared `Guard`, `Modal`, `Receipt`. These are the
  `"use client"` boundary.
- **`src/app/globals.css`** — Tailwind **v4** entry (`@import "tailwindcss"`)
  with a CSS-first `@theme` block defining the palette/shadow/font tokens (so
  utilities like `bg-brown`, `text-ink-muted` exist). Styling is **utility-first
  in the JSX**; only heavily-repeated primitives (buttons, cards, badges, form
  atoms) and the thermal receipt are kept as `@layer components` classes. The
  `@media print` block also lives here.
- **`xlsx`** is an npm dependency, dynamically imported only when a report is
  generated (kept out of the main bundle).

## Tests

`npm test` runs the Vitest suite over the logic layer: permissions/routing,
bill math, stock rounding, duplicate-name merge, cancel/delete restock,
`seedOwner`, and the Excel report assembly (cancelled bills excluded from
aggregates).

## Security note

Data lives entirely in the browser's `localStorage`. **User passwords are stored
in plaintext** and are viewable in the UI by the Owner. This matches the
original app's local-only design; making it safe (hashing, real auth) requires a
backend/database, which is out of scope for this client-only build.
