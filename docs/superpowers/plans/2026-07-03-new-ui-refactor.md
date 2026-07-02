# New UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Bakers Theory app to the new design in `new_UI/Bakers Theory.dc.html` — responsive sidebar/bottom-nav shell, POS billing, Recharts dashboard — without changing any business logic.

**Architecture:** View-layer refactor. Rewrite `globals.css` (theme + fonts), the app shell (`(app)/layout.tsx` + new `Sidebar`), and each feature component's JSX to match the mockup. All store actions, types, excel export, receipts, printing, permissions, and owner-auth stay untouched. New testable logic (chart-data derivation) is isolated in `src/lib/analytics.ts` and unit-tested.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript (strict), Tailwind v4 (CSS-first `@theme` in `globals.css`), Zustand, xlsx, **Recharts** (new), `next/font/google`.

## Global Constraints

- Do **NOT** modify: `src/lib/store.ts`, `src/lib/types.ts`, `src/lib/ui-store.ts`, `src/lib/excel.ts`, `src/lib/bill.ts`, `src/lib/permissions.ts`, `src/lib/format.ts`, `src/lib/constants.ts`, or any `*.test.ts` (except adding the new `analytics.test.ts`).
- `npm test`, `npm run typecheck`, `npm run lint` must pass after **every** task.
- Visual source of truth: `new_UI/Bakers Theory.dc.html` (markup + inline styles) and its `renderVals()` (lines 467–598) for derived-value formulas. Ignore the mockup's fake Desktop/Phone toggle and its hard-coded dummy data — use the real Zustand store.
- Palette (Tailwind tokens in `globals.css` `@theme`): brown `#7c4a1e`, brown-dark `#5a3414`, brown-light `#a0622a`, cream `#fdf6ee`, cream-dark `#e9ddc9`, warm-white `#fffcf8`, ink `#2c1a0e`, ink-muted `#7a5c3e`, ink-light `#b08060`, line `#e8d5bb`, line-soft `#f2e6d2`, success `#2d7a3a`/`#e8f2e9`, danger `#c0392b`/`#fbeae7`, warn `#b8860b`/`#fbf3df`.
- Fonts: **Figtree** (sans body/UI), **Newsreader** (italic serif, wordmark only). Load via `next/font/google` — no `<link>` tags.
- Money/counts use tabular numerals (`.num` utility or `tabular-nums`). Currency formatting stays `₹` + `toLocaleString('en-IN')` where the app already does it; do not change existing formatting helpers.
- Responsive breakpoint: sidebar visible at `lg` (1024px) and up; `BottomNav` visible below `lg`.
- Commit after every task with a `feat:`/`refactor:`/`style:` message.

---

### Task 1: Theme tokens + web fonts foundation

**Files:**
- Modify: `src/app/globals.css` (the `@theme` block + `@layer base` body/font rules)
- Modify: `src/app/layout.tsx` (add `next/font` and apply the font CSS variables to `<html>`/`<body>`)

**Interfaces:**
- Produces: Tailwind color utilities (`text-brown`, `bg-cream`, `border-line`, `text-ink-muted`, etc.) matching the palette; CSS variables `--font-sans` (Figtree) and `--font-serif` (Newsreader); a `.num` utility (`font-variant-numeric: tabular-nums`) and a `.wordmark` helper (Newsreader italic).

- [ ] **Step 1: Reconcile `@theme` tokens** in `globals.css` to the exact palette in Global Constraints. Add any missing tokens (`--color-cream-dark`, `--color-line-soft`). Keep the existing `@layer components` primitives (`.btn-*`, `.card`, `.badge*`, `.form-*`, `.receipt*`, `.toast`) but update their color values to the palette. **Do not remove the `@media print` block** — it is load-bearing for receipt printing.

- [ ] **Step 2: Add fonts in `src/app/layout.tsx`.**

```tsx
import { Figtree, Newsreader } from "next/font/google";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-figtree",
  display: "swap",
});
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["italic", "normal"],
  weight: ["400", "500"],
  variable: "--font-newsreader",
  display: "swap",
});
```

Apply to the root element: add `className={`${figtree.variable} ${newsreader.variable}`}` to the `<html>` (or `<body>`) tag already rendered in `RootLayout`. In `globals.css` set `--font-sans: var(--font-figtree), system-ui, sans-serif;` and add `--font-serif: var(--font-newsreader), Georgia, serif;`. Update the `@layer base` `body` rule to use `--font-sans`, and set `body` background to `--color-cream`.

- [ ] **Step 3: Add utilities.** In `globals.css` add:

```css
@layer components {
  .num { font-variant-numeric: tabular-nums; }
  .wordmark { font-family: var(--font-serif); font-style: italic; font-weight: 500; }
}
```

- [ ] **Step 4: Verify build + lint.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass (no logic touched).

- [ ] **Step 5: Manual check.** Run `npm run dev`, open `/login`; confirm Figtree renders (UI text) and no console font errors.

- [ ] **Step 6: Commit.**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "style: add new UI theme tokens and Figtree/Newsreader fonts"
```

---

### Task 2: Add Recharts dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install.**

Run: `npm install recharts`
Expected: `recharts` added to `dependencies`.

- [ ] **Step 2: Verify.**

Run: `npm run typecheck && npm run build`
Expected: build succeeds (recharts ships its own types).

- [ ] **Step 3: Commit.**

```bash
git add package.json package-lock.json
git commit -m "build: add recharts for dashboard charts"
```

---

### Task 3: Chart-data helpers (TDD)

**Files:**
- Create: `src/lib/analytics.ts`
- Test: `src/lib/analytics.test.ts`

**Interfaces:**
- Consumes: `Bill`, `Item` from `src/lib/types.ts`; `isActiveBill` from `src/lib/format.ts`.
- Produces:
  - `weeklySales(bills: Bill[], now: Date): { label: string; total: number }[]` — 7 entries, oldest→newest, `label` = weekday short name (`Mon`…`Sun`), `total` = sum of **active** bills' `total` whose `date` falls on that calendar day (last 7 days ending `now`).
  - `topItems(bills: Bill[], limit = 5): { name: string; qty: number }[]` — item names by total quantity sold across **active** bills, descending, capped at `limit`.
  - `categoryRevenue(bills: Bill[], items: Item[]): { category: string; revenue: number }[]` — revenue per item category (`line.qty * line.price`) across **active** bills, joined to `items` by `itemId` for category; descending.

- [ ] **Step 1: Write failing tests** in `src/lib/analytics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { weeklySales, topItems, categoryRevenue } from "./analytics";
import type { Bill, Item } from "./types";

const day = (iso: string) => iso; // bills store ISO date strings in `date`

function bill(partial: Partial<Bill>): Bill {
  return {
    id: partial.id ?? "b1",
    billNo: partial.billNo ?? 1001,
    customer: partial.customer ?? { name: "X", phone: "" },
    items: partial.items ?? [],
    subtotal: partial.subtotal ?? 0,
    tax: partial.tax ?? 0,
    total: partial.total ?? 0,
    taxRate: partial.taxRate ?? 5,
    date: partial.date ?? "2026-07-03T10:00:00.000Z",
    status: partial.status ?? "active",
  } as Bill;
}

describe("weeklySales", () => {
  it("returns 7 buckets oldest to newest ending today", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const res = weeklySales([bill({ total: 100, date: "2026-07-03T09:00:00.000Z" })], now);
    expect(res).toHaveLength(7);
    expect(res[6].total).toBe(100); // today is last bucket
  });
  it("excludes cancelled bills", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const res = weeklySales([bill({ total: 100, status: "cancelled", date: "2026-07-03T09:00:00.000Z" })], now);
    expect(res[6].total).toBe(0);
  });
});

describe("topItems", () => {
  it("ranks items by quantity sold, descending, capped", () => {
    const b = bill({
      items: [
        { itemId: "i1", name: "Croissant", emoji: "🥐", unit: "pcs", qty: 2, price: 45, costPrice: 20 },
        { itemId: "i2", name: "Donut", emoji: "🍩", unit: "pcs", qty: 5, price: 40, costPrice: 15 },
      ],
    });
    const res = topItems([b], 5);
    expect(res[0]).toEqual({ name: "Donut", qty: 5 });
    expect(res[1]).toEqual({ name: "Croissant", qty: 2 });
  });
});

describe("categoryRevenue", () => {
  it("sums revenue per category", () => {
    const items: Item[] = [
      { id: "i1", name: "Croissant", emoji: "🥐", category: "Pastries", unit: "pcs", price: 45, costPrice: 20, qty: 10 },
    ];
    const b = bill({
      items: [{ itemId: "i1", name: "Croissant", emoji: "🥐", unit: "pcs", qty: 2, price: 45, costPrice: 20 }],
    });
    const res = categoryRevenue([b], items);
    expect(res).toEqual([{ category: "Pastries", revenue: 90 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/lib/analytics.test.ts`
Expected: FAIL (`analytics.ts` not found).

- [ ] **Step 3: Implement `src/lib/analytics.ts`** with the three functions per the Interfaces block. Use `isActiveBill` to filter. For `weeklySales`, build 7 day-buckets keyed by local calendar date from `now` going back 6 days; weekday label via `toLocaleDateString("en-US", { weekday: "short" })`.

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/lib/analytics.test.ts`
Expected: PASS. Then `npm test` (full suite) → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/analytics.ts src/lib/analytics.test.ts
git commit -m "feat: add analytics helpers for dashboard charts"
```

---

### Task 4: Shared primitives restyle (Modal, tabClass)

**Files:**
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/components/ui/tabClass.ts`

**Interfaces:**
- Consumes: nothing new. Signatures unchanged: `Modal({ title, onClose, children })`, `tabCls(active: boolean): string`.
- Produces: re-themed modal (warm-white panel, `--color-line` border, rounded, mockup shadow) and `tabCls` matching the mockup's segmented pill (see mockup `tab(a)` at line 552 and `chip(a)` at line 511).

- [ ] **Step 1: Restyle `Modal.tsx`** — keep the exact props/behavior (backdrop click closes, `✕` button, `max-w-[600px]`, scrollable). Update classes: panel `bg-warm-white border border-line rounded-t-[20px]` (phone bottom-sheet) / centered rounded card on `sm+`; header `<h2>` uses `text-ink` weight 800.

- [ ] **Step 2: Restyle `tabClass.ts`** to return the mockup's tab style: active = `bg-warm-white text-brown shadow-[0_1px_4px_rgba(100,60,20,.12)]`, inactive = `text-[#8a6a3c]`; both `rounded-[9px] px-[18px] py-2 text-[13.5px] font-bold`. The container in consumers uses `bg-[#f4e7d2] p-1 rounded-xl`.

- [ ] **Step 3: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/Modal.tsx src/components/ui/tabClass.ts
git commit -m "style: re-theme Modal and tab controls"
```

---

### Task 5: Responsive shell — Sidebar + layout + Topbar + BottomNav

**Files:**
- Create: `src/components/layout/Sidebar.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/layout/Topbar.tsx`
- Modify: `src/components/layout/BottomNav.tsx`

**Interfaces:**
- Consumes: `useCurrentUser` (store), `navItems(user)` + `hasPermission` (permissions.ts), `useBakeryStore` for `logout` + `bakery`, `usePathname`/`useRouter` (next/navigation).
- Produces: `Sidebar()` (default-exported or named `export function Sidebar()`); shell layout with sidebar at `lg+` and bottom-nav below.

- [ ] **Step 1: Create `Sidebar.tsx`** — visual per mockup lines 67–91: logo tile + `.wordmark` "Bakers Theory" + "STORE MANAGER"; "MENU" label; nav buttons (Dashboard, New Bill→`/bill`, Inventory→`/stock`, History, Settings) built from `navItems(user)` plus a Settings entry; active state via `usePathname()` (brown filled vs `text-ink-muted`); user footer with initials avatar, `user.name`, `user.role`, sign-out button (`logout()` → `router.push("/login")`). Permission-gate each nav entry exactly as `BottomNav` does. Wrap the whole `<aside>` in `className="hidden lg:flex ..."`.

- [ ] **Step 2: Rewrite `(app)/layout.tsx` shell** — keep the existing hydration/auth gate logic verbatim (reads `_hasHydrated` + `useCurrentUser`, redirects to `/login`, renders `null` until hydrated). Change only the returned markup to:

```tsx
<div className="flex min-h-screen bg-cream">
  <Sidebar />
  <div className="flex min-w-0 flex-1 flex-col">
    <Topbar />
    <main className="flex-1 overflow-y-auto p-4 lg:px-8 lg:py-6 animate-fade-in">
      {children}
    </main>
    <BottomNav />
  </div>
</div>
```

- [ ] **Step 3: Restyle `Topbar.tsx`** — per mockup lines 97–104: sticky, `bg-warm-white/90 backdrop-blur border-b border-line`. Left: screen title + subtitle derived from `usePathname()` (map: `/dashboard`→["Dashboard", greeting], `/bill`→["New Bill","Tap products to build the order"], `/stock`→["Inventory","Manage items, stock levels & pricing"], `/history`→["History","Past bills and stock movements"], `/settings`→["Settings","Store profile, staff & permissions"]). Right: a desktop-only "New Bill" button (`hidden lg:flex`) → `/bill`, gated by `hasPermission(user,"sales")`. Keep the existing Settings + Logout affordances reachable (they now live in the Sidebar footer on desktop; keep a compact logout/settings on the Topbar for phone, OR rely on BottomNav "More"→Settings — see Step 4). Drop the decorative notification bell.

- [ ] **Step 4: Restyle `BottomNav.tsx`** — per mockup lines 389–395: `lg:hidden`, `bg-warm-white border-t border-line`; render `navItems(user)` as icon+label; center "Bill" as the raised brown FAB; include a "More"→`/settings` entry so phone users reach Settings. Active state via `usePathname()`. Keep returning `null` when the user has no nav items.

- [ ] **Step 5: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Manual check.** `npm run dev`, log in as Owner. At desktop width: sidebar visible, bottom-nav hidden. Narrow to <1024px: sidebar hidden, bottom-nav visible. Nav between all five routes; active highlighting correct; sign-out works.

- [ ] **Step 7: Commit.**

```bash
git add src/components/layout/ src/app/\(app\)/layout.tsx
git commit -m "refactor: responsive sidebar + bottom-nav app shell"
```

---

### Task 6: Login screen redesign

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: existing `login` action + post-login routing (`defaultRoute`) — reuse the file's current handler logic verbatim; change only markup/classes.

- [ ] **Step 1: Restyle** per mockup lines 42–60: centered card on `radial-gradient(circle at 30% 12%, #fff7ec, #efdfc4)` full-screen wrap; logo tile (🥐 gradient), `.wordmark` "Bakers Theory", "STORE MANAGER"; User ID + Password inputs (labels styled `text-[#8a6a3c]`), brown "Sign in" button, owner-demo hint line. Keep the existing state, `login()` call, error handling, and redirect exactly as they are.

- [ ] **Step 2: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 3: Manual check.** Log in with Owner credentials (`7873557430` / `Dominar@400`) → lands on dashboard. Wrong password → error shows.

- [ ] **Step 4: Commit.**

```bash
git add src/app/login/page.tsx
git commit -m "style: redesign login screen"
```

---

### Task 7: Dashboard redesign + Recharts

**Files:**
- Modify: `src/components/feature/dashboard/Dashboard.tsx`
- (Optional) Create: `src/components/feature/dashboard/SalesChart.tsx`, `TopItemsChart.tsx`, `CategoryChart.tsx` if the file grows unwieldy — split chart components out.

**Interfaces:**
- Consumes: `useBakeryStore` (`items`, `bills`, `bakery`), `useCurrentUser`, `hasPermission(user,"analytics")`, `exportExcelReport` + `ReportData` (excel.ts — unchanged call pattern: `const { bakery, items, bills, logs } = useBakeryStore.getState()`), `weeklySales`/`topItems`/`categoryRevenue` (analytics.ts), `isActiveBill` (format.ts), `ItemModal`, `ViewBillModal`, Recharts.
- **BEFORE writing any chart code, load the `dataviz` skill** and apply its palette/mark/axis/legend guidance.

- [ ] **Step 1: Stat tiles** per mockup lines 112–133. Compute from store with real formulas (mirror mockup `renderVals` intent but on real data): Today's Sales = sum of today's active bills' totals (+ delta vs yesterday), Bills Today = count of today's active bills (+ avg/bill), Items Sold = sum of today's active bill line qtys, Low Stock = `items.filter(i => i.qty <= bakery.lowStockAlert).length`. Use `.num` for figures. Keep the existing low-stock warning banner if present.

- [ ] **Step 2: Charts card** — replace nothing-that-exists (there are no charts today). Add a "Sales this week" card containing a Recharts `<BarChart>` fed by `weeklySales(bills, new Date())`; highlight the last (today) bar with brown. Add a second card with `topItems` (horizontal `<BarChart>`) and a third with `categoryRevenue` (`<PieChart>` or bar). Wrap all charts in Recharts `<ResponsiveContainer>`. **Gate the charts area behind `hasPermission(user, "analytics")`** (non-analytics users see the rest of the dashboard without charts). Theme colors from the palette.

- [ ] **Step 3: Recent Bills, Quick Actions, Low Stock alerts** per mockup lines 150–184. Recent bills = `bills.slice(-5).reverse()`, each opens `ViewBillModal`. Quick Actions = "Create new bill" (→`/bill`, gated `sales`), "Add stock" (opens Stock-In modal — reuse `addOpen`-style local state, render `StockInForm` in a `Modal`), both permission-gated. Low-stock alerts list items where `qty <= bakery.lowStockAlert`; "Restock" opens the Stock-In modal preselected if feasible, else the plain Stock-In modal.

- [ ] **Step 4: Excel export** — keep the analytics-gated "Download Excel Report" button calling the existing `doExport` (unchanged: reads `useBakeryStore.getState()`, `await exportExcelReport(...)`, toasts result).

- [ ] **Step 5: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Manual check.** Dashboard renders charts from real bills (create a couple bills first to see data), stat tiles correct, recent bills open, quick actions + restock open the right modals, Excel export downloads the workbook. As a Staff user without analytics, charts + export are hidden.

- [ ] **Step 7: Commit.**

```bash
git add src/components/feature/dashboard/
git commit -m "feat: redesign dashboard with Recharts analytics"
```

---

### Task 8: Billing POS redesign

**Files:**
- Modify: `src/components/feature/bill/Bill.tsx`
- Delete: `src/components/feature/bill/BillItemModal.tsx`

**Interfaces:**
- Consumes: `useBakeryStore` (`items`, `bakery.taxRate`), `computeTotals(lines, taxRate)` (bill.ts), `generateBill(customer, lines)` (store), `requestPrint` (ui-store), `Receipt`, `Modal`, `CATS` (constants.ts).
- Produces: POS cart flow; `BillLine` construction identical to today (capture `itemId, name, emoji, unit, qty, price, costPrice` from the selected `Item`).

- [ ] **Step 1: Rebuild `Bill.tsx` layout** per mockup lines 246–304: two-column grid (`lg`: `1fr 372px`; phone: stacked). Left = search input + category chips (`CATS`) + product grid (cards from `items` filtered by search+category; show emoji, name, `₹price`, and an in-cart qty badge). Tapping a product card calls a local `addToCart(item)`.

- [ ] **Step 2: Cart state** — local `lines: BillLine[]` and `customer {name, phone}`. `addToCart` merges by `itemId` (qty++). Cart lines render with `−`/`+` steppers (`dec`/`inc`, removing at qty 0) and line totals. Build each `BillLine` from the `Item` exactly as `BillItemModal`/`Bill` do today (capture `costPrice`).

- [ ] **Step 3: Order panel** — sticky right card: customer name/phone inputs, cart lines (scrollable), subtotal/tax/total from `computeTotals(lines, bakery.taxRate)`, "Generate bill · {total}" button. `generate()` calls `generateBill(customer, lines)`, then shows the returned `Bill` in a `Modal` with `<Receipt bill={...}/>`, Print (`requestPrint`) and Done (clears cart + customer). Empty-cart state per mockup lines 276–278. Guard: empty cart → toast "Add items to the order first".

- [ ] **Step 4: Delete `BillItemModal.tsx`** and remove its import/usage from `Bill.tsx`.

- [ ] **Step 5: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass (no test references `BillItemModal`; if any does, that's a signal — check `grep -r BillItemModal src`).

- [ ] **Step 6: Manual check.** Add products via grid, adjust qty with steppers, tax/total update, Generate → receipt modal → Print opens print view → Done clears order and stock decremented (check Inventory).

- [ ] **Step 7: Commit.**

```bash
git add src/components/feature/bill/
git commit -m "feat: POS-style billing with product grid and cart"
```

---

### Task 9: Inventory redesign + Stock In/Out modals

**Files:**
- Modify: `src/components/feature/stock/Stock.tsx`
- Modify: `src/components/feature/stock/StockInForm.tsx` (make it render cleanly inside `Modal`)
- Modify: `src/components/feature/stock/StockOutForm.tsx` (same)

**Interfaces:**
- Consumes: `useBakeryStore` (`items`, `bakery.lowStockAlert`, `deleteItem`), `requireOwnerAuth` (ui-store), `CATS` (constants.ts), `ItemModal`, `StockInForm`, `StockOutForm`, `Modal`.
- Note: `Stock`'s `initialTab` prop is now unused by the new UI; keep the prop in the signature (StockPage still passes it) but it no longer drives tabs — accept and ignore, or repurpose `?tab=in`/`?tab=out` to auto-open the corresponding modal on mount.

- [ ] **Step 1: Stat tiles** per mockup lines 192–197: Total items (`items.length`), Units in stock (`sum qty`), Stock value (`sum price*qty`), Low/out (`qty <= lowStockAlert`).

- [ ] **Step 2: Toolbar + chips** per mockup lines 199–209: search input, "Add item" button (opens `ItemModal` with `itemId: null`), "Add stock" button (opens `StockInForm` in a `Modal`), category chips (`["All", ...CATS]`).

- [ ] **Step 3: Item list** — desktop **table** (mockup lines 212–227: Item / Category / Price / In stock / Status) and phone **cards** (lines 230–239), toggled by Tailwind `hidden lg:block` / `lg:hidden`. Status badge via qty vs `lowStockAlert` (Out `0`, Low `<=alert`, In stock). Row actions: edit (`ItemModal` with the item id), delete (via `requireOwnerAuth("Delete item", () => deleteItem(id))`).

- [ ] **Step 4: Stock In/Out modals** — replace the old All/In/Out tabs. Local state `modal: { type: "add"|"edit"|"stockin"|"stockout"; id?: string } | null`. Render `StockInForm`/`StockOutForm` wrapped in `<Modal>`; on successful submit, close the modal (forms already toast + reset). If repurposing `initialTab`, open the matching modal on mount.

- [ ] **Step 5: Adjust the two forms** so their outer wrapper works inside `Modal` (drop their own `.card` outer chrome if it double-wraps; keep all fields, validation, `stockIn`/`stockOut` calls unchanged).

- [ ] **Step 6: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 7: Manual check.** Add/edit/delete item (delete asks owner password); Add stock modal increments qty + logs; Restock from dashboard opens same modal; Stock out validates against available qty; table shows on desktop, cards on phone.

- [ ] **Step 8: Commit.**

```bash
git add src/components/feature/stock/
git commit -m "feat: redesign inventory with table/cards and stock modals"
```

---

### Task 10: History redesign

**Files:**
- Modify: `src/components/feature/history/History.tsx`

**Interfaces:**
- Consumes: `useBakeryStore` (`bills`, `logs`), `useCurrentUser` + `hasPermission` (`sales`/`inventory`), `cancelBill`, `deleteBill`, `requireOwnerAuth`, `ViewBillModal`, `tabCls`, `formatDateFull` (format.ts).

- [ ] **Step 1: Tabs + search/filters** per mockup lines 308–322: Bills / Stock Log segmented tabs (gate each by permission as today), search input, status filter chips (All/Active/Cancelled) for the Bills tab.

- [ ] **Step 2: Bills list** per mockup lines 323–333: reversed bill cards (initials avatar, customer, `#billNo · N items · time`, status badge, total). Keep View (`ViewBillModal`), Cancel (`cancelBill`, `confirm()`), Delete (`deleteBill` via `requireOwnerAuth`) actions.

- [ ] **Step 3: Stock Log list** per mockup lines 335–345: reversed color-coded entries; icon/sign by type (`in`/`out`/`cancel`/`delete`/`bill`), item + emoji, type label + meta (supplier/reason/notes), qty + time. Preserve the existing `logIcon`/type mapping.

- [ ] **Step 4: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 5: Manual check.** Bills tab: filter by status, view a receipt, cancel (stock restored), delete (owner auth). Stock Log tab: entries color-coded and detailed. Permission-limited user sees only permitted tabs.

- [ ] **Step 6: Commit.**

```bash
git add src/components/feature/history/
git commit -m "style: redesign history bills and stock log"
```

---

### Task 11: Settings redesign (keep full functionality)

**Files:**
- Modify: `src/components/feature/settings/Settings.tsx`
- Modify: `src/components/feature/settings/UserManagement.tsx`
- Modify: `src/components/feature/settings/UserModal.tsx`
- Modify: `src/components/feature/settings/MyAccount.tsx`

**Interfaces:**
- Consumes: `useBakeryStore` (`bakery`, `saveSettings`, `uploadLogo`, `removeLogo`, `clearAllData`, `users`, `addUser`, `editUser`, `deleteUser`), `useCurrentUser`, `changeOwnPassword`, `exportExcelReport`, `CURRENCIES` (constants.ts), `Modal`, `requireOwnerAuth`.

- [ ] **Step 1: Two-column layout** per mockup lines 351–383. Keep the existing role branch: non-Owner returns `<MyAccount/>` (restyle only). Left card = **Bakery profile**: logo upload (FileReader→`uploadLogo`, remove), name, tagline, address, phone, gst, currency (`CURRENCIES` select), tax rate, low-stock alert, Save (`saveSettings` → route `/dashboard`). Right card = **Staff & permissions**: render `<UserManagement/>` styled like the mockup's staff cards.

- [ ] **Step 2: Keep extras** — Excel report button (`doExport`, unchanged), Danger Zone (`clearAllData` with double `confirm()`), version footer "Bakers Theory v0.1". Place them below the two columns.

- [ ] **Step 3: Restyle `UserManagement.tsx`** — staff cards per mockup lines 369–380 (avatar, name, `ID · userId`, role badge, Sales/Inventory/Analytics permission pills using `permOn`/`permOff` styles at mockup lines 555–556). Keep add (`+ Add staff` → `UserModal`), edit, delete (Owner row not editable/deletable), password reveal (`revealed` Set). Keep delete-current-user → `/login`.

- [ ] **Step 4: Restyle `UserModal.tsx`** and **`MyAccount.tsx`** — same fields/logic, new theme (inputs, badges, buttons). `MyAccount`: account card + access badges + change-password + logout.

- [ ] **Step 5: Verify.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Manual check.** As Owner: edit + save profile (logo upload works), currency/tax/low-stock persist, add/edit/delete staff, reveal password, Excel export, danger-zone clears data. As Staff: MyAccount view with change-password + logout; no owner controls.

- [ ] **Step 7: Commit.**

```bash
git add src/components/feature/settings/
git commit -m "feat: redesign settings with two-column layout and staff management"
```

---

### Task 12: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full suite.**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green; production build succeeds.

- [ ] **Step 2: Cross-screen manual QA.** Log in as Owner; walk Dashboard → Billing (generate + print) → Inventory (CRUD + stock in/out) → History (view/cancel/delete + logs) → Settings (save + user CRUD + Excel export). Verify at desktop (sidebar) and phone (<1024px, bottom-nav) widths. Then log in as a permission-limited Staff user and confirm nav/section gating + MyAccount.

- [ ] **Step 3: Confirm no leftover references** to removed pieces.

Run: `grep -rn "BillItemModal" src` → expect no results. `grep -rn "notification" src/components/layout` → expect none from the dropped bell.

- [ ] **Step 4: Commit any final touch-ups**, then this branch is ready for review/merge.

---

## Self-Review

**Spec coverage:**
- Theme + fonts → Task 1. ✅
- Recharts dep → Task 2. ✅
- Chart data (weekly/top/category) → Task 3 (+ used in Task 7). ✅
- Responsive shell (sidebar/topbar/bottom-nav, drop device toggle) → Task 5. ✅
- Login → Task 6. ✅
- Dashboard (tiles, charts, recent, quick actions, low stock, excel) → Task 7. ✅
- Billing POS (grid, cart, generate, receipt/print), remove BillItemModal → Task 8. ✅
- Inventory (tiles, table/cards, CRUD, stock in/out modals) → Task 9. ✅
- History (bills/logs tabs) → Task 10. ✅
- Settings (two-column, all extras, user mgmt, MyAccount) → Task 11. ✅
- Excel export on both Dashboard + Settings → Tasks 7 & 11. ✅
- Modal/tabClass restyle → Task 4. ✅
- Preserve store/logic/tests, receipts, printing, permissions, owner-auth → Global Constraints + per-task "Consumes". ✅
- Drop notification bell → Task 5 Step 3; verified Task 12 Step 3. ✅
- Verification (tests green, typecheck, lint, manual) → every task + Task 12. ✅

**Placeholder scan:** No TBD/TODO; chart-helper code and tests are concrete; screen tasks reference the mockup's exact line ranges + enumerate exact store bindings rather than "handle appropriately".

**Type consistency:** `weeklySales`/`topItems`/`categoryRevenue` signatures identical in Task 3 (definition) and Task 7 (use). `BillLine` construction in Task 8 matches the fields listed. `Modal`/`tabCls` signatures unchanged across Tasks 4, 8, 9, 10, 11.
