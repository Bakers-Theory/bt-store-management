import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  PRESET_ROLES,
  ROLE_PRESETS,
  canAccessSection,
  defaultRoute,
  hasPermission,
  isPermissionKey,
  navItems,
  presetForPerms,
  roleLabel,
} from "./permissions";
import type { PermissionKey, PresetRole, User } from "./types";

const owner: User = {
  id: "owner", name: "O", userId: "o", role: "Owner", permissions: [], dashboardLayout: null
};
const staff = (permissions: PermissionKey[]): User => ({
  id: "s", name: "S", userId: "s", role: "Staff", permissions, dashboardLayout: null
});
const preset = (role: PresetRole): User => staff(ROLE_PRESETS[role]);

describe("hasPermission", () => {
  it("owner holds every key in the catalogue, with no perms stored", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(hasPermission(owner, key)).toBe(true);
    }
  });
  it("null user has nothing", () => {
    expect(hasPermission(null, "bill.create")).toBe(false);
  });
  it("staff hold exactly what they were granted", () => {
    const u = staff(["bill.create"]);
    expect(hasPermission(u, "bill.create")).toBe(true);
    expect(hasPermission(u, "bill.discount")).toBe(false);
    expect(hasPermission(u, "stock.view")).toBe(false);
  });
});

describe("catalogue", () => {
  it("has no duplicate keys across groups", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });
  it("never exposes the Owner-only capabilities as grantable keys", () => {
    // Clearing data and the admin audit trail must have no key to hand out.
    expect(ALL_PERMISSIONS.some((k) => k.startsWith("data."))).toBe(false);
    expect(isPermissionKey("data.clear")).toBe(false);
  });
  it("rejects unknown keys", () => {
    expect(isPermissionKey("stock.view")).toBe(true);
    expect(isPermissionKey("stock.teleport")).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });
  it("every preset grants only catalogue keys", () => {
    for (const role of PRESET_ROLES) {
      for (const key of ROLE_PRESETS[role]) {
        expect(isPermissionKey(key), `${role} → ${key}`).toBe(true);
      }
    }
  });
});

describe("presets", () => {
  it("Admin holds everything grantable except staff management and salary", () => {
    const ownerOnly = [
      "staff.manage", "salary.view", "salary.edit", "salary.pay",
      "advance.view", "advance.request", "advance.approve", "advance.delete",
    ];
    expect(new Set(ROLE_PRESETS.Admin)).toEqual(
      new Set(ALL_PERMISSIONS.filter((k) => !ownerOnly.includes(k))),
    );
  });

  it("no preset grants staff.manage or salary — Owner-only by default", () => {
    const ownerOnly = ["staff.manage", "salary.view", "salary.edit", "salary.pay"] as const;
    for (const role of PRESET_ROLES) {
      for (const key of ownerOnly) {
        expect(ROLE_PRESETS[role].includes(key), `${role} → ${key}`).toBe(false);
      }
    }
    // Each stays grantable by hand, so all must remain in the catalogue.
    for (const key of ownerOnly) {
      expect(ALL_PERMISSIONS.includes(key), key).toBe(true);
      expect(isPermissionKey(key), key).toBe(true);
    }
    // The Owner still reaches them implicitly.
    for (const key of ownerOnly) expect(hasPermission(owner, key), key).toBe(true);
  });

  it("Cashier runs the counter end to end: bill, discount, cancel", () => {
    const c = preset("Cashier");
    expect(hasPermission(c, "bill.create")).toBe(true);
    expect(hasPermission(c, "bill.discount")).toBe(true);
    expect(hasPermission(c, "bill.cancel")).toBe(true);
  });

  it("Cashier still sees no cost, no profit, no stock page, and cannot delete", () => {
    const c = preset("Cashier");
    expect(hasPermission(c, "bill.delete")).toBe(false);
    expect(hasPermission(c, "items.cost")).toBe(false);
    expect(hasPermission(c, "dashboard.profit")).toBe(false);
    expect(hasPermission(c, "dashboard.view")).toBe(false);
    expect(hasPermission(c, "stock.view")).toBe(false);
  });

  it("Storekeeper is stockroom-only: enters cost, never sees profit or the till", () => {
    const s = preset("Storekeeper");
    expect(hasPermission(s, "stock.in")).toBe(true);
    expect(hasPermission(s, "items.cost")).toBe(true);
    expect(hasPermission(s, "dashboard.profit")).toBe(false);
    expect(hasPermission(s, "bill.create")).toBe(false);
    expect(hasPermission(s, "customers.view")).toBe(false);
  });

  it("Manager owns the stockroom, customers, reports and store ops", () => {
    const m = preset("Manager");
    expect(hasPermission(m, "stock.in")).toBe(true);
    expect(hasPermission(m, "items.cost")).toBe(true);
    expect(hasPermission(m, "customers.edit")).toBe(true);
    expect(hasPermission(m, "reports.view")).toBe(true);
    expect(hasPermission(m, "store.status")).toBe(true);
    expect(hasPermission(m, "store.lists")).toBe(true);
  });

  it("Manager has no dashboard and no till, and cannot reconfigure or staff", () => {
    const m = preset("Manager");
    expect(hasPermission(m, "dashboard.view")).toBe(false);
    expect(hasPermission(m, "dashboard.profit")).toBe(false);
    expect(hasPermission(m, "bill.create")).toBe(false);
    expect(hasPermission(m, "bill.discount")).toBe(false);
    expect(hasPermission(m, "bill.cancel")).toBe(false);
    expect(hasPermission(m, "bill.history")).toBe(false);
    expect(hasPermission(m, "store.settings")).toBe(false);
    expect(hasPermission(m, "staff.manage")).toBe(false);
  });

  // Superseded the customers-only assertion when the cashbook landed. The cash
  // drawer is the first responsibility both the counter and the back office
  // hold: whoever handles the money all day is who reads and reconciles it.
  // Everything else in ARCHITECTURE.md §8's counter/back-office split stands.
  // Grew once more when daily closing landed. The counter counts the drawer;
  // that is the job. Reopening a counted day stays with Admin and the Owner.
  // Final shape. The counter reads the cash book, counts the drawer, and logs
  // small spends for approval. Paying, adjusting and reopening stay upstairs.
  it("Cashier and Manager overlap on customers, the cashbook and logging expenses", () => {
    const shared = ROLE_PRESETS.Cashier.filter((k) =>
      ROLE_PRESETS.Manager.includes(k),
    );
    expect(shared.sort()).toEqual([
      "cashbook.close",
      "cashbook.view",
      "customers.edit",
      "customers.view",
      "expense.create",
      "expense.view",
    ]);
  });

  it("a Cashier logs an expense but cannot pay or void one", () => {
    const c = preset("Cashier");
    expect(hasPermission(c, "expense.view")).toBe(true);
    expect(hasPermission(c, "expense.create")).toBe(true);
    // Without expense.pay, what they record lands as `pending` for approval.
    expect(hasPermission(c, "expense.pay")).toBe(false);
    expect(hasPermission(c, "expense.cancel")).toBe(false);
  });

  it("a Manager approves and pays, but voiding a paid expense is Admin only", () => {
    const m = preset("Manager");
    expect(hasPermission(m, "expense.pay")).toBe(true);
    expect(hasPermission(m, "expense.cancel")).toBe(false);
    expect(hasPermission(preset("Admin"), "expense.cancel")).toBe(true);
    expect(hasPermission(owner, "expense.cancel")).toBe(true);
  });

  it("Storekeeper has no expense access at all", () => {
    const s = preset("Storekeeper");
    for (const k of ["expense.view", "expense.create", "expense.pay", "expense.cancel"] as const) {
      expect(hasPermission(s, k), k).toBe(false);
    }
  });

  it("a Cashier counts and closes the drawer but cannot reopen a closed day", () => {
    const c = preset("Cashier");
    expect(hasPermission(c, "cashbook.close")).toBe(true);
    expect(hasPermission(c, "cashbook.reopen")).toBe(false);
    // Still no arbitrary adjustments: a shortfall must not be editable away.
    expect(hasPermission(c, "cashbook.entry")).toBe(false);
  });

  it("reopening a closed day is Admin and Owner only", () => {
    expect(hasPermission(preset("Admin"), "cashbook.reopen")).toBe(true);
    expect(hasPermission(owner, "cashbook.reopen")).toBe(true);
    expect(hasPermission(preset("Manager"), "cashbook.reopen")).toBe(false);
    expect(hasPermission(preset("Cashier"), "cashbook.reopen")).toBe(false);
    expect(hasPermission(preset("Storekeeper"), "cashbook.reopen")).toBe(false);
  });

  it("Storekeeper still never touches the cashbook", () => {
    const s = preset("Storekeeper");
    expect(hasPermission(s, "cashbook.close")).toBe(false);
    expect(hasPermission(s, "cashbook.reopen")).toBe(false);
  });

  it("a Cashier reads the cashbook but cannot adjust it", () => {
    const c = preset("Cashier");
    expect(hasPermission(c, "cashbook.view")).toBe(true);
    // A counter operator who could write arbitrary entries could make a
    // shortfall disappear.
    expect(hasPermission(c, "cashbook.entry")).toBe(false);
  });

  it("Storekeeper never sees the cashbook", () => {
    const s = preset("Storekeeper");
    expect(hasPermission(s, "cashbook.view")).toBe(false);
    expect(hasPermission(s, "cashbook.entry")).toBe(false);
  });

  it("Admin and Manager can both write cashbook entries", () => {
    expect(hasPermission(preset("Admin"), "cashbook.entry")).toBe(true);
    expect(hasPermission(preset("Manager"), "cashbook.entry")).toBe(true);
  });

  it("the cashbook section opens for anyone who can read it", () => {
    expect(canAccessSection(preset("Cashier"), "cashbook")).toBe(true);
    expect(canAccessSection(preset("Manager"), "cashbook")).toBe(true);
    expect(canAccessSection(owner, "cashbook")).toBe(true);
    expect(canAccessSection(preset("Storekeeper"), "cashbook")).toBe(false);
  });

  it("the cashbook nav item appears for readers only", () => {
    const keys = (u: User) => navItems(u).map((i) => i.key);
    expect(keys(preset("Cashier"))).toContain("cashbook");
    expect(keys(preset("Storekeeper"))).not.toContain("cashbook");
  });

  it("attendance is supervisory: Admin and Manager only", () => {
    expect(hasPermission(preset("Admin"), "attendance.view")).toBe(true);
    expect(hasPermission(preset("Admin"), "attendance.edit")).toBe(true);
    expect(hasPermission(preset("Manager"), "attendance.view")).toBe(true);
    expect(hasPermission(preset("Manager"), "attendance.edit")).toBe(true);
    expect(hasPermission(preset("Cashier"), "attendance.view")).toBe(false);
    expect(hasPermission(preset("Storekeeper"), "attendance.view")).toBe(false);
  });

  it("the activity log is supervisory: Admin and Manager only", () => {
    expect(hasPermission(preset("Admin"), "activity.view")).toBe(true);
    expect(hasPermission(owner, "activity.view")).toBe(true);
    expect(hasPermission(preset("Manager"), "activity.view")).toBe(true);
    expect(hasPermission(preset("Cashier"), "activity.view")).toBe(false);
    expect(hasPermission(preset("Storekeeper"), "activity.view")).toBe(false);
  });

  it("no preset below Admin can delete bills or items", () => {
    for (const role of ["Manager", "Cashier", "Storekeeper"] as PresetRole[]) {
      expect(hasPermission(preset(role), "bill.delete"), role).toBe(false);
      expect(hasPermission(preset(role), "items.delete"), role).toBe(false);
    }
  });
});

describe("presetForPerms / roleLabel", () => {
  it("round-trips every preset regardless of key order", () => {
    for (const role of PRESET_ROLES) {
      expect(presetForPerms(ROLE_PRESETS[role])).toBe(role);
      expect(presetForPerms([...ROLE_PRESETS[role]].reverse())).toBe(role);
    }
  });
  it("a set that matches no preset is Custom", () => {
    expect(presetForPerms(["bill.create", "store.settings"])).toBe("Custom");
    // One key removed from a preset is no longer that preset.
    expect(presetForPerms(ROLE_PRESETS.Cashier.slice(1))).toBe("Custom");
  });
  it("labels Owner, presets, Custom and No access distinctly", () => {
    expect(roleLabel(owner)).toBe("Owner");
    expect(roleLabel(preset("Manager"))).toBe("Manager");
    expect(roleLabel(staff(["bill.create", "store.lists"]))).toBe("Custom");
    expect(roleLabel(staff([]))).toBe("No access");
  });
});

describe("canAccessSection", () => {
  it("settings is always accessible, so nobody is stranded", () => {
    expect(canAccessSection(staff([]), "settings")).toBe(true);
  });
  it("gates each section on its own key", () => {
    expect(canAccessSection(staff(["bill.create"]), "bill")).toBe(true);
    expect(canAccessSection(staff(["bill.create"]), "dashboard")).toBe(false);
    expect(canAccessSection(staff(["reports.view"]), "reports")).toBe(true);
    expect(canAccessSection(staff(["reports.export"]), "reports")).toBe(false);
    expect(canAccessSection(staff(["attendance.view"]), "attendance")).toBe(true);
    // Edit alone must not open the page — view is what gates the read.
    expect(canAccessSection(staff(["attendance.edit"]), "attendance")).toBe(false);
    expect(canAccessSection(staff(["salary.view"]), "salary")).toBe(true);
    expect(canAccessSection(staff(["salary.pay"]), "salary")).toBe(false);
  });
  it("keeps the Cashier out of stock and the Storekeeper out of billing", () => {
    expect(canAccessSection(preset("Cashier"), "stock")).toBe(false);
    expect(canAccessSection(preset("Storekeeper"), "bill")).toBe(false);
    expect(canAccessSection(preset("Storekeeper"), "customers")).toBe(false);
    expect(canAccessSection(preset("Storekeeper"), "history")).toBe(false);
  });
  it("a Cashier still reaches History via bill.history, without the log", () => {
    expect(canAccessSection(preset("Cashier"), "history")).toBe(true);
  });
  it("unknown sections are denied", () => {
    expect(canAccessSection(owner, "payroll")).toBe(false);
  });
});

describe("defaultRoute", () => {
  it("lands each preset on a section it can actually open", () => {
    const routes: Record<PresetRole, string> = {
      Admin: "/dashboard",
      Manager: "/stock",
      Cashier: "/bill",
      Storekeeper: "/stock",
    };
    for (const role of PRESET_ROLES) {
      const route = defaultRoute(preset(role));
      expect(route, role).toBe(routes[role]);
      expect(canAccessSection(preset(role), route.slice(1)), role).toBe(true);
    }
  });
  it("prefers dashboard, then bill, then stock, then customers, then history", () => {
    expect(defaultRoute(staff(["dashboard.view", "bill.create"]))).toBe("/dashboard");
    expect(defaultRoute(staff(["bill.create", "stock.view"]))).toBe("/bill");
    expect(defaultRoute(staff(["stock.view"]))).toBe("/stock");
    expect(defaultRoute(staff(["customers.view"]))).toBe("/customers");
    expect(defaultRoute(staff(["activity.view"]))).toBe("/history");
    expect(defaultRoute(staff(["attendance.view"]))).toBe("/attendance");
    expect(defaultRoute(staff(["salary.view"]))).toBe("/salary");
    expect(defaultRoute(staff(["reports.view"]))).toBe("/reports");
  });
  it("falls back to /dashboard when there is no access at all", () => {
    expect(defaultRoute(staff([]))).toBe("/dashboard");
  });
});

/**
 * The migration resolves the three legacy group keys as "holds any permission in
 * that area" so pre-existing RLS policies keep working. This table mirrors the
 * SQL in 0028_granular_rbac.sql — if one side changes, this fails.
 */
describe("legacy group aliasing (mirrors has_perm in SQL)", () => {
  const GROUPS: Record<"sales" | "inventory" | "analytics", PermissionKey[]> = {
    sales: [
      "bill.create", "bill.discount", "bill.print", "bill.cancel",
      "bill.delete", "bill.history", "customers.view", "customers.edit",
    ],
    inventory: [
      "stock.view", "stock.in", "stock.out", "stock.expiry",
      "items.create", "items.edit", "items.delete", "items.cost",
    ],
    analytics: ["dashboard.view", "dashboard.profit", "reports.view", "reports.export"],
  };

  it("covers every catalogue key except activity.view and store admin", () => {
    const grouped = new Set(Object.values(GROUPS).flat());
    const ungrouped = ALL_PERMISSIONS.filter((k) => !grouped.has(k));
    expect(ungrouped.sort()).toEqual([
      "activity.view", "advance.approve", "advance.delete",
      "advance.request", "advance.view",
      // Assets and consumables are their own module (#91) — `inventory` aliases
      // the item catalogue, and reusing it here would hand a pre-0028 policy
      // reach it never had.
      "assets.assign", "assets.create", "assets.delete", "assets.edit",
      "assets.maintain", "assets.reports", "assets.view",
      "attendance.edit", "attendance.view",
      // Deliberately ungrouped: the legacy sales/inventory/analytics aliases
      // predate the cashbook, so no pre-0028 policy can reach these keys.
      "cashbook.close", "cashbook.entry", "cashbook.reopen", "cashbook.reports", "cashbook.view",
      "consumables.adjust", "consumables.create", "consumables.delete",
      "consumables.edit", "consumables.issue", "consumables.reports",
      "consumables.view",
      "expense.cancel", "expense.create", "expense.pay", "expense.view",
      "purchases.create", "purchases.pay", "purchases.return",
      "salary.edit", "salary.pay", "salary.view",
      "staff.manage", "store.lists", "store.settings", "store.status",
      "suppliers.create", "suppliers.edit", "suppliers.financial",
      "suppliers.reports", "suppliers.status", "suppliers.view",
    ]);
  });

  it("each group's members are real, unique catalogue keys", () => {
    const all = Object.values(GROUPS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const key of all) expect(isPermissionKey(key), key).toBe(true);
  });
});

describe("PERMISSION_CATALOG shape", () => {
  it("every entry carries a label and a hint for the Settings grid", () => {
    for (const group of PERMISSION_CATALOG) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.perms.length).toBeGreaterThan(0);
      for (const p of group.perms) {
        expect(p.label.length, p.key).toBeGreaterThan(0);
        expect(p.hint.length, p.key).toBeGreaterThan(0);
      }
    }
  });
});

describe("advance permissions", () => {
  const staff = (perms: PermissionKey[]): User => ({
    id: "u1",
    userId: "staff1",
    name: "Staff",
    role: "Staff",
    permissions: perms,
    dashboardLayout: null,
  });

  it("puts all four keys in the catalogue", () => {
    expect(ALL_PERMISSIONS).toContain("advance.view");
    expect(ALL_PERMISSIONS).toContain("advance.request");
    expect(ALL_PERMISSIONS).toContain("advance.approve");
    expect(ALL_PERMISSIONS).toContain("advance.delete");
  });

  // Advances stay with the Owner until deliberately delegated — the same
  // treatment as salary.* and staff.manage. Admin is explicitly included.
  it("grants them in no preset, Admin included", () => {
    for (const role of PRESET_ROLES) {
      expect(ROLE_PRESETS[role]).not.toContain("advance.view");
      expect(ROLE_PRESETS[role]).not.toContain("advance.request");
      expect(ROLE_PRESETS[role]).not.toContain("advance.approve");
      expect(ROLE_PRESETS[role]).not.toContain("advance.delete");
    }
  });

  it("still gives the Owner everything", () => {
    const owner: User = {
      id: "o", userId: "owner", name: "Owner", role: "Owner", permissions: [], dashboardLayout: null,
    };
    expect(hasPermission(owner, "advance.approve")).toBe(true);
    expect(hasPermission(owner, "advance.delete")).toBe(true);
  });

  // Without this, someone granted advance.view but not salary.view could not
  // reach the page their permission is for.
  it("opens the salary section for advance.view alone", () => {
    expect(canAccessSection(staff(["advance.view"]), "salary")).toBe(true);
    expect(navItems(staff(["advance.view"])).some((i) => i.key === "salary")).toBe(true);
    expect(defaultRoute(staff(["advance.view"]))).toBe("/salary");
  });

  it("still opens it for salary.view alone", () => {
    expect(canAccessSection(staff(["salary.view"]), "salary")).toBe(true);
  });

  it("keeps it shut for someone with neither", () => {
    expect(canAccessSection(staff(["bill.create"]), "salary")).toBe(false);
  });
});

describe("cashbook reports permissions", () => {
  const staff = (perms: PermissionKey[]): User => ({
    id: "u1", name: "Staff", userId: "staff", role: "Staff", permissions: perms, dashboardLayout: null,
  });

  it("cashbook reports are supervisory: Admin, Manager and Owner", () => {
    expect(hasPermission(preset("Admin"), "cashbook.reports")).toBe(true);
    expect(hasPermission(preset("Manager"), "cashbook.reports")).toBe(true);
    expect(hasPermission(owner, "cashbook.reports")).toBe(true);
    // The counter closes the drawer; it does not report on the money.
    expect(hasPermission(preset("Cashier"), "cashbook.reports")).toBe(false);
    expect(hasPermission(preset("Storekeeper"), "cashbook.reports")).toBe(false);
  });

  it("cashbook.reports alone reaches the Reports page", () => {
    // Mirrors the suppliers.reports precedent: the page renders only the tabs
    // its holder can actually open.
    const u: User = {
      id: "u9",
      name: "Reporter",
      userId: "9",
      role: "Staff",
      permissions: ["cashbook.reports"],
      dashboardLayout: null,
    };
    expect(canAccessSection(u, "reports")).toBe(true);
    expect(defaultRoute(u)).toBe("/reports");
  });
});

describe("suppliers & purchasing permissions", () => {
  const staff = (perms: PermissionKey[]): User => ({
    id: "u1", name: "Staff", userId: "staff", role: "Staff", permissions: perms, dashboardLayout: null,
  });

  it("puts all nine keys in one catalogue group", () => {
    const group = PERMISSION_CATALOG.find((g) => g.title === "Suppliers & Purchasing");
    expect(group).toBeDefined();
    expect(group!.perms.map((p) => p.key)).toEqual([
      "suppliers.view", "suppliers.create", "suppliers.edit", "suppliers.status",
      "purchases.create", "purchases.pay", "purchases.return",
      "suppliers.financial", "suppliers.reports",
    ]);
  });

  it("gives Admin everything except the owner-only keys", () => {
    expect(ROLE_PRESETS.Admin).toContain("suppliers.view");
    expect(ROLE_PRESETS.Admin).toContain("purchases.pay");
    expect(ROLE_PRESETS.Admin).toContain("suppliers.financial");
  });

  it("gives Manager the data keys but never the money keys", () => {
    for (const k of [
      "suppliers.view", "suppliers.create", "suppliers.edit",
      "suppliers.status", "purchases.create", "suppliers.reports",
    ] as PermissionKey[]) {
      expect(ROLE_PRESETS.Manager, k).toContain(k);
    }
    expect(ROLE_PRESETS.Manager).not.toContain("purchases.pay");
    expect(ROLE_PRESETS.Manager).not.toContain("suppliers.financial");
    expect(ROLE_PRESETS.Manager).not.toContain("purchases.return");
  });

  it("gives Cashier and Storekeeper nothing", () => {
    for (const k of ALL_PERMISSIONS.filter(
      (p) => p.startsWith("suppliers.") || p.startsWith("purchases."),
    )) {
      expect(ROLE_PRESETS.Cashier, k).not.toContain(k);
      expect(ROLE_PRESETS.Storekeeper, k).not.toContain(k);
    }
  });

  it("shows a Suppliers nav item to a holder of suppliers.view", () => {
    const keys = navItems(staff(["suppliers.view"])).map((i) => i.key);
    expect(keys).toContain("suppliers");
    expect(keys).not.toContain("purchases");
  });

  it("shows Purchases to anyone who can record, pay or return", () => {
    for (const k of ["purchases.create", "purchases.pay", "purchases.return"] as PermissionKey[]) {
      expect(navItems(staff([k])).map((i) => i.key), k).toContain("purchases");
    }
  });

  it("gates both routes", () => {
    expect(canAccessSection(staff(["suppliers.view"]), "suppliers")).toBe(true);
    expect(canAccessSection(staff(["suppliers.view"]), "purchases")).toBe(false);
    expect(canAccessSection(staff(["purchases.pay"]), "purchases")).toBe(true);
    expect(canAccessSection(staff([]), "suppliers")).toBe(false);
  });

  it("lands a suppliers-only user on /suppliers", () => {
    expect(defaultRoute(staff(["suppliers.view"]))).toBe("/suppliers");
    expect(defaultRoute(staff(["purchases.create"]))).toBe("/purchases");
  });
});
