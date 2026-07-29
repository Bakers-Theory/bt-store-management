import type { PermissionKey, PresetRole, RoleLabel, User } from "./types";

export function hasPermission(user: User | null, perm: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === "Owner") return true;
  return user.permissions.includes(perm);
}

/** True if the user holds at least one of `perms`. */
export function hasAnyPermission(
  user: User | null,
  perms: PermissionKey[],
): boolean {
  return perms.some((p) => hasPermission(user, p));
}

// ─── Catalogue ──────────────────────────────────────────────────────────────

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  hint: string;
}

export interface PermissionGroup {
  title: string;
  perms: PermissionMeta[];
}

/**
 * Everything an Owner can hand out, grouped the way the Settings grid renders
 * it. Adding a key here (and to `PermissionKey`) makes it appear in the UI; the
 * matching SQL check is what actually enforces it.
 */
export const PERMISSION_CATALOG: PermissionGroup[] = [
  {
    title: "Dashboard",
    perms: [
      { key: "dashboard.view", label: "View dashboard", hint: "Sales KPIs, charts and stock health" },
      { key: "dashboard.profit", label: "View profit & margins", hint: "Cost of goods, profit and margin figures" },
    ],
  },
  {
    title: "Billing",
    perms: [
      { key: "bill.create", label: "Create bills", hint: "Ring up sales at the counter" },
      { key: "bill.discount", label: "Apply discounts", hint: "Reduce a bill by a percentage or flat amount" },
      { key: "bill.print", label: "Print receipts", hint: "Print and reprint thermal receipts" },
      { key: "bill.cancel", label: "Cancel bills", hint: "Void a bill and return its stock" },
      { key: "bill.delete", label: "Delete bills", hint: "Permanently remove a bill — leaves no trail" },
      { key: "bill.history", label: "View bill history", hint: "Browse and search past bills" },
    ],
  },
  {
    title: "Inventory",
    perms: [
      { key: "stock.view", label: "View stock & quantities", hint: "Open the Stock page and see levels" },
      { key: "stock.in", label: "Add stock", hint: "Receive deliveries into inventory" },
      { key: "stock.out", label: "Remove stock", hint: "Record wastage, damage and returns" },
      { key: "stock.expiry", label: "Manage expiry & write-offs", hint: "Edit batch expiry dates and write off expired stock" },
      { key: "items.create", label: "Create items", hint: "Add new products to the catalogue" },
      { key: "items.edit", label: "Edit items", hint: "Change name, price, category, unit or photo" },
      { key: "items.delete", label: "Delete items", hint: "Permanently remove a product" },
      { key: "items.cost", label: "View & set purchase price", hint: "See and enter what was paid to the supplier" },
    ],
  },
  {
    title: "Customers",
    perms: [
      { key: "customers.view", label: "View customers", hint: "Browse the customer directory and spend" },
      { key: "customers.edit", label: "Add & edit customers", hint: "Create and update customer records" },
    ],
  },
  {
    title: "Reports",
    perms: [
      { key: "reports.view", label: "View reports", hint: "Open the Reports page" },
      { key: "reports.export", label: "Export to Excel", hint: "Download report workbooks" },
    ],
  },
  {
    title: "Attendance",
    perms: [
      { key: "attendance.view", label: "View attendance", hint: "See who was present, absent or on leave" },
      { key: "attendance.edit", label: "Record & edit attendance", hint: "Mark the day and correct earlier entries" },
    ],
  },
  {
    title: "Salary",
    perms: [
      { key: "salary.view", label: "View salaries & payroll", hint: "See what each employee earns and their payment history" },
      { key: "salary.edit", label: "Set salaries & run payroll", hint: "Change a salary and prepare the monthly payroll" },
      { key: "salary.pay", label: "Record payments", hint: "Mark a month paid, with date and payment mode" },
    ],
  },
  {
    title: "Advances",
    perms: [
      { key: "advance.view", label: "View advances & balances", hint: "See what each employee owes and their advance history" },
      { key: "advance.request", label: "Record advances", hint: "Put in a request for an advance against salary" },
      { key: "advance.approve", label: "Approve & hand over advances", hint: "Approve or refuse a request, with date and payment mode" },
      { key: "advance.delete", label: "Delete decided advances", hint: "Undo a mistaken approval or refusal — leaves no trail" },
    ],
  },
  {
    title: "Suppliers & Purchasing",
    perms: [
      { key: "suppliers.view", label: "View suppliers", hint: "Browse supplier records and the products they supply" },
      { key: "suppliers.create", label: "Add suppliers", hint: "Create a new external or in-house supplier" },
      { key: "suppliers.edit", label: "Edit suppliers", hint: "Change contact, address, GSTIN or payment terms" },
      { key: "suppliers.status", label: "Activate & deactivate suppliers", hint: "Retire a supplier without losing their history" },
      { key: "purchases.create", label: "Record purchases", hint: "Enter and post a purchase invoice or in-house receipt" },
      { key: "purchases.pay", label: "Record supplier payments", hint: "Log money paid to a supplier, with date and mode" },
      { key: "purchases.return", label: "Raise purchase returns", hint: "Issue a credit note against a posted invoice" },
      { key: "suppliers.financial", label: "View supplier money", hint: "Amounts, balances and the account summary" },
      { key: "suppliers.reports", label: "Supplier reports", hint: "The six purchase reports and their exports" },
    ],
  },
  {
    title: "Store admin",
    perms: [
      { key: "store.settings", label: "Store profile & tax", hint: "Name, address, GST, tax rate, thresholds, logo" },
      { key: "store.status", label: "Open & close store", hint: "Toggle whether the store is trading" },
      { key: "store.lists", label: "Manage lists", hint: "Categories, units, emojis and stock-out reasons" },
      { key: "staff.manage", label: "Manage staff", hint: "Add staff and change their permissions" },
      { key: "activity.view", label: "View activity log", hint: "Stock movements and bill events" },
    ],
  },
];

/** Every grantable key, in catalogue order. */
export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_CATALOG.flatMap((g) =>
  g.perms.map((p) => p.key),
);

const LABELS = new Map<PermissionKey, string>(
  PERMISSION_CATALOG.flatMap((g) => g.perms.map((p) => [p.key, p.label] as const)),
);

/** Human label for a key, for audit entries and summaries. */
export const permissionLabel = (key: PermissionKey): string =>
  LABELS.get(key) ?? key;

/** True if `value` is a key in the catalogue (input validation). */
export const isPermissionKey = (value: unknown): value is PermissionKey =>
  typeof value === "string" && LABELS.has(value as PermissionKey);

// ─── Presets ────────────────────────────────────────────────────────────────

/**
 * Starting points, not authorities. Picking a preset copies its set into the
 * user's permissions; the set is then editable and the role becomes `Custom`.
 *
 * The two staff roles are disjoint by design: Cashier owns the counter (bill,
 * discount, cancel — but no stock, cost or dashboard), Manager owns the
 * stockroom, customers, reports and store operations (but never the till or the
 * dashboard). Storekeeper is Manager narrowed to stock alone.
 *
 * The activity log is a supervisory view, so only Admin and Manager get
 * `activity.view`. A Cashier still reaches History for their own bills via
 * `bill.history`; a Storekeeper has no History at all.
 *
 * Attendance is likewise supervisory — Admin and Manager only. Employee records
 * are confidential, so nobody at the counter or in the stockroom sees them.
 *
 * No preset below Admin gets `*.delete` — cancelling and writing off leave an
 * audit trail, deleting does not.
 *
 * `staff.manage` and the three `salary.*` keys are in no preset at all: staff
 * management and payroll stay with the Owner by default. They remain in the
 * catalogue, so each can be ticked by hand for one trusted person without
 * handing over a whole preset.
 */
/** Keys no preset grants — delegated one person at a time, or not at all. */
const OWNER_BY_DEFAULT: PermissionKey[] = [
  "staff.manage",
  "salary.view",
  "salary.edit",
  "salary.pay",
  // Advances are money against a salary, so they get the same treatment.
  "advance.view",
  "advance.request",
  "advance.approve",
  "advance.delete",
  // Paying a supplier is money leaving the till, so it gets the same treatment
  // as payroll: grantable, but in no preset.
  "purchases.pay",
];

export const ROLE_PRESETS: Record<PresetRole, PermissionKey[]> = {
  // Admin is the one preset trusted with supplier payments; every other
  // OWNER_BY_DEFAULT key stays delegated one person at a time.
  Admin: [
    ...ALL_PERMISSIONS.filter((k) => !OWNER_BY_DEFAULT.includes(k)),
    "purchases.pay",
  ],
  Manager: [
    "stock.view",
    "stock.in",
    "stock.out",
    "stock.expiry",
    "items.create",
    "items.edit",
    "items.cost",
    "customers.view",
    "customers.edit",
    "reports.view",
    "reports.export",
    "store.status",
    "store.lists",
    "activity.view",
    "suppliers.view",
    "suppliers.create",
    "suppliers.edit",
    "suppliers.status",
    "purchases.create",
    "suppliers.reports",
    "attendance.view",
    "attendance.edit",
  ],
  Cashier: [
    "bill.create",
    "bill.discount",
    "bill.print",
    "bill.cancel",
    "bill.history",
    "customers.view",
    "customers.edit",
  ],
  Storekeeper: [
    "stock.view",
    "stock.in",
    "stock.out",
    "stock.expiry",
    "items.create",
    "items.edit",
    "items.cost",
  ],
};

export const PRESET_ROLES = Object.keys(ROLE_PRESETS) as PresetRole[];

const sameSet = (a: PermissionKey[], b: PermissionKey[]): boolean =>
  a.length === b.length && a.every((k) => b.includes(k));

/**
 * The preset a permission set matches exactly, or `Custom`. Nothing stores this
 * — deriving it is what keeps a role badge from ever contradicting the grants.
 */
export function presetForPerms(perms: PermissionKey[]): PresetRole | "Custom" {
  return PRESET_ROLES.find((r) => sameSet(perms, ROLE_PRESETS[r])) ?? "Custom";
}

/** The badge to show for a user: Owner, a preset name, Custom, or No access. */
export function roleLabel(user: User): RoleLabel {
  if (user.role === "Owner") return "Owner";
  if (user.permissions.length === 0) return "No access";
  return presetForPerms(user.permissions);
}

// ─── Navigation & routing ───────────────────────────────────────────────────

export interface NavItem {
  key: string;
  href: string;
  icon: string;
  label: string;
}

/** Nav entries the user is allowed to see, in fixed order. */
export function navItems(user: User | null): NavItem[] {
  const items: NavItem[] = [];
  if (hasPermission(user, "dashboard.view"))
    items.push({ key: "dashboard", href: "/dashboard", icon: "📊", label: "Dashboard" });
  if (hasPermission(user, "stock.view"))
    items.push({ key: "stock", href: "/stock", icon: "📦", label: "Stock" });
  if (hasPermission(user, "suppliers.view"))
    items.push({ key: "suppliers", href: "/suppliers", icon: "🚚", label: "Suppliers" });
  if (hasAnyPermission(user, ["purchases.create", "purchases.pay", "purchases.return"]))
    items.push({ key: "purchases", href: "/purchases", icon: "🧮", label: "Purchases" });
  if (hasPermission(user, "bill.create"))
    items.push({ key: "bill", href: "/bill", icon: "🧾", label: "Bill" });
  if (hasPermission(user, "customers.view"))
    items.push({ key: "customers", href: "/customers", icon: "👥", label: "Customers" });
  if (hasAnyPermission(user, ["bill.history", "activity.view"]))
    items.push({ key: "history", href: "/history", icon: "📋", label: "History" });
  if (hasPermission(user, "attendance.view"))
    items.push({ key: "attendance", href: "/attendance", icon: "🗓️", label: "Attendance" });
  // advance.view alone must reach the page too — Salary.tsx renders only the
  // tabs the holder can actually open.
  if (hasAnyPermission(user, ["salary.view", "advance.view"]))
    items.push({ key: "salary", href: "/salary", icon: "💰", label: "Salary" });
  return items;
}

/** Can the user open a given section route? (settings is always allowed) */
export function canAccessSection(user: User | null, section: string): boolean {
  switch (section) {
    case "dashboard":
      return hasPermission(user, "dashboard.view");
    case "stock":
      return hasPermission(user, "stock.view");
    case "bill":
      return hasPermission(user, "bill.create");
    case "customers":
      return hasPermission(user, "customers.view");
    case "history":
      return hasAnyPermission(user, ["bill.history", "activity.view"]);
    case "attendance":
      return hasPermission(user, "attendance.view");
    case "salary":
      return hasAnyPermission(user, ["salary.view", "advance.view"]);
    case "suppliers":
      return hasPermission(user, "suppliers.view");
    case "purchases":
      return hasAnyPermission(user, ["purchases.create", "purchases.pay", "purchases.return"]);
    case "reports":
      // Someone may hold suppliers.reports without reports.view — the page
      // renders only the tabs they can actually open.
      return hasAnyPermission(user, ["reports.view", "suppliers.reports"]);
    case "settings":
      return true; // My Account is always reachable
    default:
      return false;
  }
}

/** Landing route after login — the first section the user can actually open. */
export function defaultRoute(user: User | null): string {
  if (hasPermission(user, "dashboard.view")) return "/dashboard";
  if (hasPermission(user, "bill.create")) return "/bill";
  if (hasPermission(user, "stock.view")) return "/stock";
  if (hasPermission(user, "suppliers.view")) return "/suppliers";
  if (hasAnyPermission(user, ["purchases.create", "purchases.pay", "purchases.return"]))
    return "/purchases";
  if (hasPermission(user, "customers.view")) return "/customers";
  if (hasAnyPermission(user, ["bill.history", "activity.view"])) return "/history";
  if (hasPermission(user, "attendance.view")) return "/attendance";
  if (hasAnyPermission(user, ["salary.view", "advance.view"])) return "/salary";
  if (hasAnyPermission(user, ["reports.view", "suppliers.reports"])) return "/reports";
  return "/dashboard"; // no access — page renders the "No Access" state
}
