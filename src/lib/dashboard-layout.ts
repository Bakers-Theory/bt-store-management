import { hasAnyPermission, hasPermission } from "./permissions";
import type { DashboardWidgetSlot, PermissionKey, StoredLayout, User } from "./types";

export interface WidgetDef {
  id: string;
  title: string;
  defaultSpan: 1 | 2 | 3 | 4;
  minSpan: 1 | 2 | 3 | 4;
  /** false = opt-in only: never auto-appended, only reachable via "Add widget". */
  defaultVisible: boolean;
  /** Fixed mobile column span out of a 2-col mobile grid — see the plan's
   *  Global Constraints. 1 for the 4 KPI tiles (today's 2-up), 2 (full width)
   *  for everything else. Not user-adjustable. */
  mobileSpan: 1 | 2;
  /** Omitted = visible to anyone regardless of permission. */
  permission?: PermissionKey | PermissionKey[];
}

export const DASHBOARD_WIDGETS: WidgetDef[] = [
  { id: "kpi-sales", title: "Sales", defaultSpan: 1, minSpan: 1, defaultVisible: true, mobileSpan: 1 },
  { id: "kpi-bills", title: "Bills", defaultSpan: 1, minSpan: 1, defaultVisible: true, mobileSpan: 1 },
  { id: "kpi-items", title: "Items Sold", defaultSpan: 1, minSpan: 1, defaultVisible: true, mobileSpan: 1 },
  { id: "kpi-lowstock", title: "Low Stock", defaultSpan: 1, minSpan: 1, defaultVisible: true, mobileSpan: 1 },
  { id: "sales-chart", title: "Sales over range", defaultSpan: 3, minSpan: 2, defaultVisible: true, mobileSpan: 2, permission: "dashboard.view" },
  { id: "quick-actions", title: "Quick Actions", defaultSpan: 1, minSpan: 1, defaultVisible: true, mobileSpan: 2 },
  { id: "top-items", title: "Top items", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2, permission: "dashboard.view" },
  { id: "category-pl", title: "Sales & profit by category", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2, permission: "dashboard.view" },
  { id: "business-boosters", title: "Business Boosters", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2, permission: "dashboard.view" },
  { id: "recent-bills", title: "Recent Bills", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2 },
  { id: "top-customers", title: "Top customers", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2, permission: "customers.view" },
  { id: "stock-health", title: "Stock Health", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2, permission: "stock.view" },
  { id: "cashbook-summary", title: "Cashbook", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2, permission: "cashbook.view" },
  { id: "supplier-balance", title: "Suppliers & Purchases", defaultSpan: 2, minSpan: 1, defaultVisible: true, mobileSpan: 2, permission: "suppliers.financial" },
  { id: "attendance-today", title: "Attendance", defaultSpan: 2, minSpan: 1, defaultVisible: false, mobileSpan: 2, permission: "attendance.view" },
];

export const DEFAULT_LAYOUT: StoredLayout = {
  visible: DASHBOARD_WIDGETS.filter((w) => w.defaultVisible).map((w) => ({ id: w.id, span: w.defaultSpan })),
  dismissed: [],
};

function isSlotArray(v: unknown): v is DashboardWidgetSlot[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        s !== null &&
        typeof s === "object" &&
        typeof (s as { id: unknown }).id === "string" &&
        typeof (s as { span: unknown }).span === "number",
    )
  );
}

export function isStoredLayout(v: unknown): v is StoredLayout {
  if (v === null || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return isSlotArray(obj.visible) && isSlotArray(obj.dismissed);
}

export function snapSpan(rawSpan: number, minSpan: number): number {
  return Math.max(minSpan, Math.min(4, Math.round(rawSpan)));
}

function widgetPasses(w: WidgetDef, user: User): boolean {
  if (!w.permission) return true;
  return Array.isArray(w.permission)
    ? hasAnyPermission(user, w.permission)
    : hasPermission(user, w.permission);
}

export function resolveLayout(
  saved: StoredLayout | null,
  user: User,
): { shown: DashboardWidgetSlot[]; addable: WidgetDef[] } {
  const registryById = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));
  const dismissedIds = new Set((saved?.dismissed ?? []).map((d) => d.id));
  const base: DashboardWidgetSlot[] = saved?.visible ?? DEFAULT_LAYOUT.visible;

  const shown: DashboardWidgetSlot[] = [];
  const seen = new Set<string>();

  for (const slot of base) {
    const w = registryById.get(slot.id);
    if (!w || !widgetPasses(w, user)) continue;
    shown.push({ id: slot.id, span: snapSpan(slot.span, w.minSpan) });
    seen.add(slot.id);
  }

  for (const w of DASHBOARD_WIDGETS) {
    if (seen.has(w.id) || !w.defaultVisible) continue;
    if (dismissedIds.has(w.id)) continue;
    if (!widgetPasses(w, user)) continue;
    shown.push({ id: w.id, span: w.defaultSpan });
    seen.add(w.id);
  }

  const addable = DASHBOARD_WIDGETS.filter((w) => !seen.has(w.id) && widgetPasses(w, user));

  return { shown, addable };
}

/** Remove a widget from the visible layout, remembering its span in `dismissed`. */
export function removeWidget(layout: StoredLayout, id: string): StoredLayout {
  const slot = layout.visible.find((s) => s.id === id);
  if (!slot) return layout;
  return {
    visible: layout.visible.filter((s) => s.id !== id),
    dismissed: [...layout.dismissed.filter((d) => d.id !== id), slot],
  };
}

/** Add a widget (back), restoring its remembered span if it has one. */
export function addWidget(layout: StoredLayout, id: string): StoredLayout {
  if (layout.visible.some((s) => s.id === id)) return layout;
  const remembered = layout.dismissed.find((d) => d.id === id);
  const w = DASHBOARD_WIDGETS.find((d) => d.id === id);
  const span = remembered?.span ?? w?.defaultSpan ?? 1;
  return {
    visible: [...layout.visible, { id, span }],
    dismissed: layout.dismissed.filter((d) => d.id !== id),
  };
}

/** Move a widget to another position in the visible order. */
export function reorderWidgets(layout: StoredLayout, fromId: string, toId: string): StoredLayout {
  const from = layout.visible.findIndex((s) => s.id === fromId);
  const to = layout.visible.findIndex((s) => s.id === toId);
  if (from === -1 || to === -1 || from === to) return layout;
  const visible = [...layout.visible];
  const [moved] = visible.splice(from, 1);
  visible.splice(to, 0, moved);
  return { ...layout, visible };
}

/** Update one visible widget's span, clamped to its registry minSpan. */
export function setWidgetSpan(layout: StoredLayout, id: string, span: number): StoredLayout {
  const w = DASHBOARD_WIDGETS.find((d) => d.id === id);
  if (!w) return layout;
  const clamped = snapSpan(span, w.minSpan);
  return {
    ...layout,
    visible: layout.visible.map((s) => (s.id === id ? { ...s, span: clamped } : s)),
  };
}
