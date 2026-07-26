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
 * Deliberate exclusions: Cashier has no `bill.discount` (the usual shrinkage
 * vector) and no Stock page. Neither Manager nor Storekeeper gets `*.delete` —
 * cancelling and writing off leave an audit trail, deleting does not.
 */
export const ROLE_PRESETS: Record<PresetRole, PermissionKey[]> = {
  Admin: ALL_PERMISSIONS,
  Manager: [
    "dashboard.view",
    "dashboard.profit",
    "bill.create",
    "bill.discount",
    "bill.print",
    "bill.cancel",
    "bill.history",
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
  ],
  Cashier: [
    "bill.create",
    "bill.print",
    "bill.history",
    "customers.view",
    "customers.edit",
    "activity.view",
  ],
  Storekeeper: [
    "stock.view",
    "stock.in",
    "stock.out",
    "stock.expiry",
    "items.create",
    "items.edit",
    "items.cost",
    "activity.view",
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
  if (hasPermission(user, "bill.create"))
    items.push({ key: "bill", href: "/bill", icon: "🧾", label: "Bill" });
  if (hasPermission(user, "customers.view"))
    items.push({ key: "customers", href: "/customers", icon: "👥", label: "Customers" });
  if (hasAnyPermission(user, ["bill.history", "activity.view"]))
    items.push({ key: "history", href: "/history", icon: "📋", label: "History" });
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
    case "reports":
      return hasPermission(user, "reports.view");
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
  if (hasPermission(user, "customers.view")) return "/customers";
  if (hasAnyPermission(user, ["bill.history", "activity.view"])) return "/history";
  if (hasPermission(user, "reports.view")) return "/reports";
  return "/dashboard"; // no access — page renders the "No Access" state
}
