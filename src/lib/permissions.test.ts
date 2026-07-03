import { describe, it, expect } from "vitest";
import { hasPermission, navItems, canAccessSection, defaultRoute } from "./permissions";
import type { User } from "./types";

const owner: User = {
  id: "owner", name: "O", userId: "o", role: "Owner",
  permissions: { sales: false, inventory: false, analytics: false },
};
const staff = (p: Partial<User["permissions"]>): User => ({
  id: "s", name: "S", userId: "s", role: "Staff",
  permissions: { sales: false, inventory: false, analytics: false, ...p },
});

describe("hasPermission", () => {
  it("owner has everything regardless of permission flags", () => {
    expect(hasPermission(owner, "sales")).toBe(true);
    expect(hasPermission(owner, "analytics")).toBe(true);
  });
  it("null user has nothing", () => {
    expect(hasPermission(null, "sales")).toBe(false);
  });
  it("staff respects their flags", () => {
    expect(hasPermission(staff({ sales: true }), "sales")).toBe(true);
    expect(hasPermission(staff({ sales: true }), "inventory")).toBe(false);
  });
});

describe("navItems", () => {
  it("orders dashboard, stock, bill, history by permission", () => {
    expect(navItems(owner).map((n) => n.key)).toEqual(["dashboard", "stock", "bill", "history"]);
  });
  it("history shows when either sales or inventory is granted", () => {
    expect(navItems(staff({ inventory: true })).map((n) => n.key)).toEqual(["stock", "history"]);
    expect(navItems(staff({})).map((n) => n.key)).toEqual([]);
  });
});

describe("canAccessSection", () => {
  it("settings is always accessible", () => {
    expect(canAccessSection(staff({}), "settings")).toBe(true);
  });
  it("gates sections on the right permission", () => {
    expect(canAccessSection(staff({ sales: true }), "bill")).toBe(true);
    expect(canAccessSection(staff({ sales: true }), "dashboard")).toBe(false);
  });
});

describe("defaultRoute", () => {
  it("prefers dashboard, then bill, then stock, then history", () => {
    expect(defaultRoute(staff({ analytics: true }))).toBe("/dashboard");
    expect(defaultRoute(staff({ sales: true }))).toBe("/bill");
    expect(defaultRoute(staff({ inventory: true }))).toBe("/stock");
  });
  it("falls back to /dashboard when no access", () => {
    expect(defaultRoute(staff({}))).toBe("/dashboard");
  });
});
