import type { PermissionKey, User } from "./types";

export function hasPermission(
  user: User | null,
  perm: PermissionKey,
): boolean {
  if (!user) return false;
  if (user.role === "Owner") return true;
  return !!(user.permissions && user.permissions[perm]);
}

export interface NavItem {
  key: string;
  href: string;
  icon: string;
  label: string;
}

/** Bottom-nav entries the user is allowed to see, in fixed order. */
export function navItems(user: User | null): NavItem[] {
  const items: NavItem[] = [];
  if (hasPermission(user, "analytics"))
    items.push({ key: "dashboard", href: "/dashboard", icon: "📊", label: "Dashboard" });
  if (hasPermission(user, "inventory"))
    items.push({ key: "stock", href: "/stock", icon: "📦", label: "Stock" });
  if (hasPermission(user, "sales"))
    items.push({ key: "bill", href: "/bill", icon: "🧾", label: "Bill" });
  if (hasPermission(user, "sales"))
    items.push({ key: "customers", href: "/customers", icon: "👥", label: "Customers" });
  if (hasPermission(user, "sales") || hasPermission(user, "inventory"))
    items.push({ key: "history", href: "/history", icon: "📋", label: "History" });
  return items;
}

/** Can the user open a given section route? (settings is always allowed) */
export function canAccessSection(user: User | null, section: string): boolean {
  switch (section) {
    case "dashboard":
      return hasPermission(user, "analytics");
    case "stock":
      return hasPermission(user, "inventory");
    case "bill":
      return hasPermission(user, "sales");
    case "customers":
      return hasPermission(user, "sales");
    case "history":
      return hasPermission(user, "sales") || hasPermission(user, "inventory");
    case "settings":
      return true;
    default:
      return false;
  }
}

/** Landing route after login, mirroring the original defaultSection(). */
export function defaultRoute(user: User | null): string {
  if (hasPermission(user, "analytics")) return "/dashboard";
  if (hasPermission(user, "sales")) return "/bill";
  if (hasPermission(user, "inventory")) return "/stock";
  if (hasPermission(user, "sales") || hasPermission(user, "inventory"))
    return "/history";
  return "/dashboard"; // no access — page renders the "No Access" state
}
