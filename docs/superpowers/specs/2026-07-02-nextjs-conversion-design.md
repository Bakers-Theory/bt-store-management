# Bakers Theory — Idiomatic Next.js Conversion (Design)

**Date:** 2026-07-02
**Status:** Approved for planning

## Problem

The project is already a Next.js 14 App Router shell, but only mechanically. All
1,543 lines of app logic live in `public/bakers-theory.js` as the original
vanilla-JS single-file app: one global mutable `state` object, `localStorage`
persistence, manual `innerHTML` rendering, inline `onclick="..."` strings, and
global `window.*` functions. `app/page.js` is a static shell of empty
`<div id="...">` containers the script fills in; `app/layout.js` loads that
script plus `xlsx` from a CDN via `next/script beforeInteractive`.

Goal: rewrite the vanilla-JS engine into idiomatic React/Next.js while keeping
the app's behavior and appearance intact.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Conversion depth | Full idiomatic React rewrite (no `window.*`, no `innerHTML`, no inline `onclick`) |
| Behavior | Parity-first; a small set of low-risk improvements allowed (§8) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| State | Zustand + `persist` middleware |
| Routing | Real App Router routes |
| Persistence | **Clean break** — default Zustand persist wrapper; old `bakery_state` data is not migrated |
| Testing | Vitest on the logic layer + manual QA checklist |
| Data layer | Stays client-side `localStorage` (no backend — out of scope) |

## Scope (features ported 1:1)

- **Auth / session:** login by userId+password, logout, session restore, seeded
  fixed Owner account, permission model (`sales`, `inventory`, `analytics`;
  Owner = all).
- **Dashboard:** stats (total items, low stock, today's revenue, today's bills),
  low-stock alert, quick actions gated by permission, recent bills (last 5),
  low-stock list, Excel download.
- **Stock:** All Items (search, add, edit, delete), Stock In form, Stock Out
  form (with reason + availability check), emoji picker, category/unit selects,
  bought vs selling price, duplicate-name → merge-to-stock behavior, manual
  qty-adjustment logging.
- **Bill:** customer details, add line items (with per-line price override and
  qty merge), live subtotal/tax/total, generate bill (deduct stock, log),
  receipt preview, thermal (76mm) print.
- **History:** Bills tab (view / cancel / delete) and Stock Log tab, gated by
  permission; cancel restocks + marks cancelled; delete is owner-gated and
  restocks if not already cancelled.
- **Settings (Owner):** bakery profile (logo upload/remove, name, tagline,
  address, phone, GST), app settings (currency, tax rate, low-stock threshold),
  Excel report, user management (add/edit/delete, view password, permissions),
  danger zone (clear all data).
- **My Account (non-owner):** read-only profile + access badges, change own
  password, logout.
- **Excel report:** 6 sheets (Summary, Inventory, Sales Report, Growth Analysis,
  Top Selling Items, Stock Log) with cancelled-bill exclusion from aggregates
  and `costOf` fallback logic — ported unchanged.
- **Owner-password gate** for destructive deletes; **toasts** for feedback.

## Target structure

```
app/
  layout.tsx              root: html/body, metadata, viewport, <ToastHost/>, <OwnerAuthHost/>
  globals.css             tailwind directives + @layer component classes + @media print
  login/page.tsx          login screen (outside auth guard)
  (app)/
    layout.tsx            client auth-guard + <Topbar/> + <BottomNav/>
    dashboard/page.tsx
    stock/page.tsx
    bill/page.tsx
    history/page.tsx
    settings/page.tsx
components/
  layout/   Topbar, BottomNav
  ui/       Button, Card, Badge, Tabs, FormField, EmptyState, Modal
  feature/
    dashboard/*
    stock/    ItemModal, StockInForm, StockOutForm, StockList
    bill/     BillItemModal, Receipt
    history/  BillsTab, StockLogTab
    settings/ BakeryProfile, AppSettings, UserManagement, UserModal, MyAccount, DangerZone
  system/   ToastHost, OwnerAuthHost
lib/
  store.ts        zustand + persist (domain state + actions)
  ui-store.ts     toast + owner-auth transient slices (non-persisted)
  types.ts        Item, Bill, BillLine, Log, User, Bakery, Permissions
  permissions.ts  hasPermission, defaultRoute
  format.ts       formatDate, formatDateFull, uid, isActiveBill
  excel.ts        exportExcelReport (npm xlsx, dynamic import)
```

## State design (`lib/store.ts`)

Single persisted Zustand store (default `persist` wrapper; localStorage key e.g.
`bakers-theory`). Shape:

```ts
{
  bakery: Bakery;
  items: Item[];
  bills: Bill[];
  logs: Log[];
  nextBillNo: number;   // starts 1001
  users: User[];
  sessionUserId: string | null;
}
```

Actions port each existing mutation exactly, preserving arithmetic and logging:

- `login(userId, password)`, `logout()`
- `saveItem(draft, id?)` — includes case-insensitive duplicate-name → add to
  existing stock (no new item), manual qty-adjustment logging on edit
- `deleteItem(id)` — owner-gated at call site
- `stockIn(...)`, `stockOut(...)` — `parseFloat((q).toFixed(3))` rounding, out
  availability check
- `generateBill(customer, lines)` — deduct stock (`Math.max(0, ...)`), push bill
  + log, bump `nextBillNo`
- `cancelBill(id, byName)` — restock, mark cancelled, log (no owner pw)
- `deleteBill(id, byName)` — owner-gated; restock if not already cancelled; log
- `addUser / editUser / deleteUser / changeOwnPassword`
- `saveSettings`, `uploadLogo`, `removeLogo`, `clearAllData`
- `seedOwner()` — run on rehydrate (`onRehydrateStorage`) so the fixed Owner
  always exists.

Transient **bill draft** (customer + in-progress line items) lives in component
state / a non-persisted slice, matching today's in-memory `billItems` behavior.

`hasPermission(user, perm)` and `defaultRoute(user)` are pure functions in
`lib/permissions.ts` (Owner → all; else `user.permissions[perm]`; default route
order: dashboard → bill → stock → history → noaccess).

## Routing & auth

`(app)/layout.tsx` (client): reads `sessionUserId`; if absent →
`router.replace('/login')`. Renders `<Topbar/>` + page + `<BottomNav/>`.
Each page guards its own permission and renders a "No Access" state when the
user lacks it. Login pushes to `defaultRoute(user)`. `<BottomNav/>` shows only
permitted tabs.

## Modals, toasts, owner-auth

- Reusable `<Modal>` primitive (bottom-sheet style, matches current CSS),
  driven by local `useState` in each feature.
- **Toast** + **owner-auth** are cross-cutting → small non-persisted slices in
  `lib/ui-store.ts` with global `<ToastHost/>` and `<OwnerAuthHost/>` mounted in
  the root layout. `requireOwnerAuth(label, onConfirm)` opens the shared
  password modal and runs `onConfirm` on the correct Owner password.

## Styling — Tailwind

`tailwind.config.ts` extends theme with the palette (`brown`, `brown-dark`,
`brown-light`, `cream`, `cream-dark`, `warm-white`, `text`, `text-muted`,
`text-light`, `success`, `danger`, `warn`, `border`, `border-strong`) plus
`borderRadius.DEFAULT` and the card `boxShadow`. Repeated patterns
(`btn-*`, `card`, `badge*`, `tab`, `stat-card`, `receipt*`, `log-entry`,
`stock-item`, `form-*`) become `@layer components` classes in `globals.css` to
preserve the exact look with low churn; one-offs use utilities. The
`@media print` receipt-only-visibility trick stays as raw CSS. Font keeps the
Segoe UI / system stack.

## xlsx

Remove the CDN `<Script>`. Add `xlsx` as an npm dependency and **dynamically
import** it inside `exportExcelReport` so it loads only on report generation.
Sheet logic ported unchanged.

## Behavior improvements (opted in)

Baseline is identical behavior. Applied improvements:

1. Inline field errors / toasts replace scattered `alert()` validation. Native
   `confirm()` double-checks for destructive actions are kept.
2. Controlled React inputs everywhere (no `document.getElementById`).

**Flagged, not changed (out of scope without a backend):** passwords are stored
in plaintext in `localStorage` and shown in the UI. A safe fix needs the data
layer that was descoped. Documented in the README.

## Success criteria (verifiable)

- `npm run build` passes: TypeScript typecheck + `next lint` clean.
- **Vitest** unit tests pass for the logic layer:
  - `hasPermission`, `defaultRoute`
  - bill subtotal/tax/total math
  - stock in/out rounding + availability guard
  - duplicate-name merge on `saveItem`
  - cancel restock, delete restock (only when not already cancelled)
  - `seedOwner` idempotency
  - Excel data assembly (aggregates exclude cancelled; `costOf` fallback)
- Manual QA parity checklist: login → dashboard → stock (add/edit/delete/in/out)
  → bill → print → history (cancel/delete) → settings (users, logo, clear) →
  excel export → logout/session-restore.

## Non-goals

- No backend / database / real auth (client-only stays).
- No migration of pre-existing `localStorage['bakery_state']` data.
- No new features beyond the two improvements above.
