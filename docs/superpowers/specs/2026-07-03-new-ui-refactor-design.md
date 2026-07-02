# New UI Refactor — Design Spec

**Date:** 2026-07-03
**Status:** Approved (design), pending implementation plan

## Goal

Refactor the Bakers Theory store-management app to the new visual design in
`new_UI/Bakers Theory.dc.html`. This is a **view-layer refactor**: rewrite the
styling, app shell, and every feature component's markup to match the new
design, while keeping all business logic, data, and non-visual behavior exactly
as-is.

Two explicit requirements from the user:

1. **Keep the Excel report export** (`src/lib/excel.ts`) — used as-is, unchanged.
2. **Use a suitable React chart library** for the dashboard charts → **Recharts**.

## Non-goals

- No changes to the data model, store, or any domain logic.
- No new features beyond what the mockup + existing app already provide.
- No backend / persistence changes (still client-side, localStorage-persisted).

## Success criteria (verifiable)

- All existing Vitest suites pass unchanged: `bill.test.ts`, `excel.test.ts`,
  `permissions.test.ts`, `store.test.ts` (`npm test`).
- `npm run typecheck` and `npm run lint` are clean.
- Excel export still works from its existing call sites and produces the same
  6-sheet workbook (`exportExcelReport` untouched).
- Every screen renders correctly at desktop (sidebar) and phone (bottom-nav)
  widths.
- Thermal receipt printing still works (`PrintHost` + `@media print`).
- Permissions still gate nav and sections; owner-auth password gate still works.

## Design decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Device toggle in mockup | Drop the fake Desktop/Phone toggle; make layout genuinely responsive. |
| Navigation | Sidebar on `lg+`, existing BottomNav on phones. |
| Billing UX | **Adopt POS product-grid → live cart** (tap cards, +/− steppers). |
| Stock In / Stock Out | **Modals** launched from Inventory (Add stock / Restock). |
| Charts | **Recharts**: weekly sales bar + top-selling items + category/revenue split. |
| Settings staff card | New look, **keep full user management** (add/edit/delete, reveal, modal). |
| Notification bell | Dropped (no backing feature). |
| Fonts | Figtree + Newsreader via `next/font`. |

## What is preserved unchanged (do NOT touch)

- `src/lib/store.ts`, `src/lib/types.ts`, `src/lib/ui-store.ts`
- `src/lib/excel.ts`, `src/lib/bill.ts`, `src/lib/permissions.ts`,
  `src/lib/format.ts`, `src/lib/constants.ts`
- All store actions/selectors, all `*.test.ts` files
- System hosts: `StoreHydrator`, `ToastHost`, `OwnerAuthHost`, `PrintHost`
- `Receipt.tsx` logic (may adjust classes only if needed; print CSS must survive)

## Theme / palette

Palette already matches the mockup closely; reconcile `globals.css` `@theme`
tokens to the mockup's exact values and add the web fonts.

- Background/cream: `#fdf6ee` / `#e9ddc9`; warm white card `#fffcf8`
- Brown: `#7c4a1e`, dark `#5a3414`, light `#a0622a`
- Ink `#2c1a0e`, ink-muted `#7a5c3e`, ink-light `#b08060`, `#8a6a3c`
- Lines `#e8d5bb`, `#f2e6d2`, `#f0e2cc`
- Status: success `#2d7a3a`/`#e8f2e9`, danger `#c0392b`/`#fbeae7`,
  warn `#b8860b`/`#fbf3df`
- Fonts: **Figtree** (sans, weights 400–800), **Newsreader** (italic serif,
  used for the "Bakers Theory" wordmark)
- Tabular numerals (`font-variant-numeric: tabular-nums`) for all money/counts

## Architecture

### App shell — `src/app/(app)/layout.tsx`

Rewrite to a responsive two-region layout:

- **Sidebar** (new `src/components/layout/Sidebar.tsx`), visible `lg+`:
  logo + wordmark, "MENU" nav (Dashboard, New Bill, Inventory, History,
  Settings) with active state, and a user footer (avatar initials, name, role,
  sign-out). Nav items permission-gated via `navItems`/`hasPermission`.
- **Main column**: sticky **Topbar** (screen title + subtitle, desktop
  "New Bill" button) over a scrolling content area.
- **BottomNav** (existing, restyled) visible below `lg`.

Auth gate behavior unchanged (redirect to `/login` when hydrated + no user;
render nothing until hydrated).

Topbar's title/subtitle is derived per-route (map like the mockup's `titles`).

### Screens (feature components — markup rewrite, same logic)

**Dashboard** (`dashboard/Dashboard.tsx`)
- 4 stat tiles from real store data: Today's Sales (+ delta vs yesterday),
  Bills Today (+ avg/bill), Items Sold, Low Stock count.
- **Charts card(s)** (Recharts): weekly sales bar (last 7 days from bills),
  top-selling items, category/revenue split. Derive series from `bills`/`items`
  in a small local helper; follow the `dataviz` skill at implementation time and
  theme to the palette.
- Recent Bills list (`bills.slice(-5).reverse()`), Quick Actions
  (New bill, Add stock → Stock-In modal), Low Stock alerts (Restock →
  Stock-In modal). Keep the analytics-gated Excel download available here.
- Still renders `ItemModal` + `ViewBillModal`.

**Billing** (`bill/Bill.tsx`) — POS layout
- Left: search + category chips + product grid (cards show emoji, name, price,
  in-cart qty badge). Tap adds to cart.
- Right: sticky **Current Order** panel — customer name/phone, cart lines with
  +/− steppers and line totals, subtotal/tax (`computeTotals`)/total, Generate
  button. Generate calls `generateBill`, then shows receipt in `Modal` with
  Print (`requestPrint`) / Done.
- Mobile: product grid on top, order panel below.
- `BillItemModal.tsx` is **removed** — the product grid fully replaces the
  add-line modal (simpler, matches the mockup).

**Inventory** (`stock/Stock.tsx`)
- Stat tiles (Total items, Units in stock, Stock value, Low/out).
- Search + category chips + "Add item".
- Desktop: table (Item / Category / Price / In stock / Status). Phone: cards.
- Row actions: edit (`ItemModal`), delete (via `requireOwnerAuth`).
- "Add stock" / "Restock" open **Stock-In / Stock-Out modals** (wrap existing
  `StockInForm` / `StockOutForm` in `Modal`). The current All/In/Out tab UI is
  replaced by this table + modal pattern.

**History** (`history/History.tsx`)
- Bills / Stock Log segmented tabs (permission-gated), restyled cards.
- Bills: cards with View / Cancel / Delete (same logic). Logs: color-coded
  in/out/cancel/delete/bill entries. Renders `ViewBillModal`.

**Settings** (`settings/Settings.tsx`)
- Two-column themed layout. Left: **Bakery profile** card — logo upload, name,
  tagline, address, phone, GST, currency, tax rate, low-stock alert, Save.
  Right: **Staff & permissions** card — staff list with avatars, role badges,
  permission pills, **full management** (add/edit/delete, password reveal via
  `UserManagement` + `UserModal`).
- Also keep: Excel report button, Danger Zone (`clearAllData`), version footer.
- Non-owner users still get `MyAccount` (return-early branch unchanged),
  restyled.

**Login** (`app/login/page.tsx`)
- Centered card matching the mockup (logo tile, italic wordmark, User ID +
  Password, Sign in). Same `login` action + routing.

### Shared UI

- `Modal.tsx`: reused; restyle to the new theme (bottom-sheet on phone is fine).
- `tabClass.ts`: restyle to the mockup's pill/segment style.
- `Receipt.tsx`: unchanged logic; print CSS in `globals.css` must keep working.

## Dependencies

- Add `recharts` (charts). No other new runtime deps.
- Fonts via `next/font/google` (Figtree, Newsreader) — no network `<link>`.

## Testing / verification plan

1. `npm test` — all existing suites green (logic untouched).
2. `npm run typecheck` + `npm run lint` clean.
3. Manual: log in as Owner; walk Dashboard (charts render from real data),
   Billing (add via grid, generate, print receipt), Inventory (add/edit/delete
   item, stock in/out modals), History (view/cancel/delete, logs), Settings
   (save profile, user CRUD, Excel export, danger zone). Check phone width
   (bottom-nav) and desktop width (sidebar).
4. Log in as a permission-limited Staff user; confirm nav/sections gate and
   MyAccount renders.

## Out of scope / risks

- Recharts adds bundle weight; acceptable for this app. Charts are client-only.
- The POS billing change is the largest behavioral shift; the receipt/print and
  `generateBill` contract are unchanged, so risk is contained to the Bill view.
