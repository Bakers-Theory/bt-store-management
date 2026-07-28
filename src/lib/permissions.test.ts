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
  id: "owner", name: "O", userId: "o", role: "Owner", permissions: [],
};
const staff = (permissions: PermissionKey[]): User => ({
  id: "s", name: "S", userId: "s", role: "Staff", permissions,
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

  it("Cashier and Manager overlap only on customers", () => {
    const shared = ROLE_PRESETS.Cashier.filter((k) =>
      ROLE_PRESETS.Manager.includes(k),
    );
    expect(shared.sort()).toEqual(["customers.edit", "customers.view"]);
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

describe("navItems", () => {
  it("orders dashboard, stock, bill, customers, history, attendance for the Owner", () => {
    expect(navItems(owner).map((n) => n.key)).toEqual([
      "dashboard", "stock", "bill", "customers", "history", "attendance", "salary",
    ]);
  });
  it("gives the Cashier a till, customers and history — but no stock page", () => {
    expect(navItems(preset("Cashier")).map((n) => n.key)).toEqual([
      "bill", "customers", "history",
    ]);
  });
  it("gives the Storekeeper stock alone — no log means no history", () => {
    expect(navItems(preset("Storekeeper")).map((n) => n.key)).toEqual(["stock"]);
  });
  it("gives the Manager stock, customers, history and attendance", () => {
    expect(navItems(preset("Manager")).map((n) => n.key)).toEqual([
      "stock", "customers", "history", "attendance",
    ]);
  });
  it("shows Salary only to salary.view holders, and to nobody by preset", () => {
    expect(navItems(staff(["salary.view"])).map((n) => n.key)).toEqual(["salary"]);
    for (const role of PRESET_ROLES) {
      expect(navItems(preset(role)).map((n) => n.key), role).not.toContain("salary");
    }
    expect(navItems(owner).map((n) => n.key)).toContain("salary");
  });
  it("shows Attendance only to attendance.view holders", () => {
    expect(navItems(staff(["attendance.view"])).map((n) => n.key)).toEqual([
      "attendance",
    ]);
    expect(navItems(staff(["attendance.edit"])).map((n) => n.key)).toEqual([]);
  });
  it("history appears for bill readers and for activity readers alike", () => {
    expect(navItems(staff(["bill.history"])).map((n) => n.key)).toEqual(["history"]);
    expect(navItems(staff(["activity.view"])).map((n) => n.key)).toEqual(["history"]);
  });
  it("a user with no permissions gets no nav", () => {
    expect(navItems(staff([])).map((n) => n.key)).toEqual([]);
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
      "attendance.edit", "attendance.view",
      "salary.edit", "salary.pay", "salary.view",
      "staff.manage", "store.lists", "store.settings", "store.status",
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
      id: "o", userId: "owner", name: "Owner", role: "Owner", permissions: [],
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
