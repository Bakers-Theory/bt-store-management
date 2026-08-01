import { describe, expect, it } from "vitest";
import {
  addWidget,
  clampHeightLevelIndex,
  DASHBOARD_WIDGETS,
  isStoredLayout,
  removeWidget,
  reorderWidgets,
  resolveLayout,
  setWidgetHeightLevel,
  setWidgetSpan,
  snapSpan,
} from "./dashboard-layout";
import type { StoredLayout, User } from "./types";

describe("isStoredLayout", () => {
  it("accepts a well-formed layout", () => {
    expect(
      isStoredLayout({ visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] }),
    ).toBe(true);
  });

  it("accepts empty arrays", () => {
    expect(isStoredLayout({ visible: [], dismissed: [] })).toBe(true);
  });

  it("rejects null", () => {
    expect(isStoredLayout(null)).toBe(false);
  });

  it("rejects a plain array (the old, pre-dismissed shape)", () => {
    expect(isStoredLayout([{ id: "kpi-sales", span: 1 }])).toBe(false);
  });

  it("rejects a slot missing span", () => {
    expect(isStoredLayout({ visible: [{ id: "kpi-sales" }], dismissed: [] })).toBe(false);
  });

  it("rejects a slot with a non-numeric span", () => {
    expect(
      isStoredLayout({ visible: [{ id: "kpi-sales", span: "2" }], dismissed: [] }),
    ).toBe(false);
  });

  it("rejects missing dismissed", () => {
    expect(isStoredLayout({ visible: [] })).toBe(false);
  });
});

describe("snapSpan", () => {
  it("rounds to the nearest integer", () => {
    expect(snapSpan(2.4, 1)).toBe(2);
    expect(snapSpan(2.6, 1)).toBe(3);
  });

  it("clamps to 4 at the top", () => {
    expect(snapSpan(7, 1)).toBe(4);
  });

  it("clamps to minSpan at the bottom", () => {
    expect(snapSpan(0, 2)).toBe(2);
    expect(snapSpan(-3, 1)).toBe(1);
  });
});

const user = (permissions: User["permissions"] = []): User => ({
  id: "u1",
  userId: "7873557430",
  name: "Test User",
  role: "Staff",
  permissions,
  dashboardLayout: null,
});

describe("resolveLayout", () => {
  it("returns the default layout when saved is null", () => {
    const { shown } = resolveLayout(null, user());
    expect(shown.map((s) => s.id)).not.toContain("attendance-today");
    expect(shown.find((s) => s.id === "kpi-sales")).toEqual({ id: "kpi-sales", span: 1 });
  });

  it("preserves a saved order and span exactly when nothing changed", () => {
    // Every default-visible, permission-free widget, reordered — with a
    // no-permission user, nothing else is eligible to auto-append, so this
    // isolates order/span preservation from the auto-append behavior tested
    // separately below.
    const saved: StoredLayout = {
      visible: [
        { id: "kpi-bills", span: 1 },
        { id: "kpi-sales", span: 1 },
        { id: "recent-bills", span: 2, heightLevel: 2 },
        { id: "kpi-items", span: 1 },
        { id: "kpi-lowstock", span: 1 },
        { id: "quick-actions", span: 1 },
      ],
      dismissed: [],
    };
    const { shown } = resolveLayout(saved, user());
    expect(shown).toEqual(saved.visible);
  });

  it("drops a widget the user has lost permission for", () => {
    const saved: StoredLayout = {
      visible: [{ id: "cashbook-summary", span: 2 }],
      dismissed: [],
    };
    const { shown } = resolveLayout(saved, user([])); // no cashbook.view
    expect(shown.find((s) => s.id === "cashbook-summary")).toBeUndefined();
  });

  it("auto-appends a default-visible widget missing from an old saved layout", () => {
    const saved: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    const { shown } = resolveLayout(saved, user(["suppliers.financial"]));
    expect(shown.some((s) => s.id === "supplier-balance")).toBe(true);
  });

  it("does NOT re-append a widget the user explicitly dismissed", () => {
    const saved: StoredLayout = {
      visible: DEFAULT_VISIBLE_WITHOUT("stock-health"),
      dismissed: [{ id: "stock-health", span: 2 }],
    };
    const { shown } = resolveLayout(saved, user(["stock.view"]));
    expect(shown.some((s) => s.id === "stock-health")).toBe(false);
  });

  it("never auto-appends attendance-today even if not dismissed", () => {
    const saved: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    const { shown } = resolveLayout(saved, user(["attendance.view"]));
    expect(shown.some((s) => s.id === "attendance-today")).toBe(false);
  });

  it("shows attendance-today once explicitly saved as visible", () => {
    const saved: StoredLayout = {
      visible: [{ id: "attendance-today", span: 2 }],
      dismissed: [],
    };
    const { shown } = resolveLayout(saved, user(["attendance.view"]));
    expect(shown.some((s) => s.id === "attendance-today")).toBe(true);
  });

  it("clamps a span below a widget's minSpan", () => {
    const saved: StoredLayout = { visible: [{ id: "sales-chart", span: 1 }], dismissed: [] };
    const { shown } = resolveLayout(saved, user(["dashboard.view"]));
    // sales-chart minSpan is 2
    expect(shown.find((s) => s.id === "sales-chart")?.span).toBe(2);
  });

  it("addable lists permission-passing widgets not currently shown", () => {
    const saved: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    const { addable } = resolveLayout(saved, user(["attendance.view"]));
    expect(addable.some((w) => w.id === "attendance-today")).toBe(true);
    expect(addable.some((w) => w.id === "kpi-sales")).toBe(false); // already shown
  });

  it("addable excludes widgets failing permission", () => {
    const { addable } = resolveLayout(null, user([])); // no cashbook.view
    expect(addable.some((w) => w.id === "cashbook-summary")).toBe(false);
  });
});

/** Every default-visible widget id except the given one, at default span. */
function DEFAULT_VISIBLE_WITHOUT(excludeId: string) {
  return DASHBOARD_WIDGETS.filter((w) => w.defaultVisible && w.id !== excludeId).map((w) => ({
    id: w.id,
    span: w.defaultSpan,
  }));
}

describe("removeWidget / addWidget round-trip", () => {
  it("moves a widget from visible to dismissed, keeping its span", () => {
    const layout: StoredLayout = {
      visible: [{ id: "stock-health", span: 3 }, { id: "kpi-sales", span: 1 }],
      dismissed: [],
    };
    const after = removeWidget(layout, "stock-health");
    expect(after.visible).toEqual([{ id: "kpi-sales", span: 1 }]);
    expect(after.dismissed).toEqual([{ id: "stock-health", span: 3 }]);
  });

  it("is a no-op when the id isn't in visible", () => {
    const layout: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    expect(removeWidget(layout, "nope")).toBe(layout);
  });

  it("re-adding a removed widget restores its remembered span", () => {
    const layout: StoredLayout = {
      visible: [{ id: "kpi-sales", span: 1 }],
      dismissed: [{ id: "stock-health", span: 3 }],
    };
    const after = addWidget(layout, "stock-health");
    // stock-health has heightLevels, so a remembered slot without one gets
    // the default middle level filled in on re-add.
    expect(after.visible).toContainEqual({ id: "stock-health", span: 3, heightLevel: 2 });
    expect(after.dismissed).toEqual([]);
  });

  it("adding a never-shown widget uses its registry default span", () => {
    const layout: StoredLayout = { visible: [], dismissed: [] };
    const after = addWidget(layout, "attendance-today");
    expect(after.visible).toContainEqual({ id: "attendance-today", span: 2 });
  });

  it("adding an already-visible widget is a no-op", () => {
    const layout: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    expect(addWidget(layout, "kpi-sales")).toBe(layout);
  });
});

describe("reorderWidgets", () => {
  it("moves the dragged widget to the drop target's position", () => {
    const layout: StoredLayout = {
      visible: [{ id: "a", span: 1 }, { id: "b", span: 1 }, { id: "c", span: 1 }],
      dismissed: [],
    };
    const after = reorderWidgets(layout, "a", "c");
    expect(after.visible.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when either id is missing or they're the same", () => {
    const layout: StoredLayout = { visible: [{ id: "a", span: 1 }], dismissed: [] };
    expect(reorderWidgets(layout, "a", "a")).toBe(layout);
    expect(reorderWidgets(layout, "a", "missing")).toBe(layout);
  });
});

describe("setWidgetSpan", () => {
  it("updates one widget's span, snapped to its minSpan", () => {
    const layout: StoredLayout = { visible: [{ id: "sales-chart", span: 3 }], dismissed: [] };
    const after = setWidgetSpan(layout, "sales-chart", 1); // minSpan 2
    expect(after.visible[0]).toEqual({ id: "sales-chart", span: 2 });
  });

  it("is a no-op for an id not in the registry", () => {
    const layout: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    expect(setWidgetSpan(layout, "not-a-widget", 3)).toBe(layout);
  });
});

describe("clampHeightLevelIndex", () => {
  it("rounds to the nearest integer", () => {
    expect(clampHeightLevelIndex(2.4, 3)).toBe(2);
    expect(clampHeightLevelIndex(2.6, 3)).toBe(3);
  });

  it("clamps to the level count at the top and 1 at the bottom", () => {
    expect(clampHeightLevelIndex(99, 3)).toBe(3);
    expect(clampHeightLevelIndex(0, 3)).toBe(1);
    expect(clampHeightLevelIndex(-5, 3)).toBe(1);
  });
});

describe("setWidgetHeightLevel", () => {
  it("updates one widget's height level, clamped to its heightLevels range", () => {
    const layout: StoredLayout = {
      visible: [{ id: "recent-bills", span: 2, heightLevel: 2 }],
      dismissed: [],
    };
    expect(setWidgetHeightLevel(layout, "recent-bills", 3).visible[0]).toEqual({
      id: "recent-bills",
      span: 2,
      heightLevel: 3,
    });
    expect(setWidgetHeightLevel(layout, "recent-bills", 99).visible[0].heightLevel).toBe(3); // only 3 levels
  });

  it("is a no-op for a widget without heightLevels", () => {
    const layout: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    expect(setWidgetHeightLevel(layout, "kpi-sales", 2)).toBe(layout);
  });

  it("is a no-op for an id not in the registry", () => {
    const layout: StoredLayout = { visible: [{ id: "kpi-sales", span: 1 }], dismissed: [] };
    expect(setWidgetHeightLevel(layout, "not-a-widget", 2)).toBe(layout);
  });
});

describe("resolveLayout — heightLevel", () => {
  it("defaults a height-capable widget missing heightLevel to its middle level", () => {
    const saved: StoredLayout = { visible: [{ id: "recent-bills", span: 2 }], dismissed: [] };
    const { shown } = resolveLayout(saved, user());
    // recent-bills heightLevels: [3, 5, 10] → middle index 2
    expect(shown.find((s) => s.id === "recent-bills")?.heightLevel).toBe(2);
  });

  it("clamps an out-of-range saved heightLevel", () => {
    const saved: StoredLayout = {
      visible: [{ id: "business-boosters", span: 2, heightLevel: 99 }],
      dismissed: [],
    };
    const { shown } = resolveLayout(saved, user(["dashboard.view"]));
    // business-boosters heightLevels: [3, 5, 9] → 3 levels, clamp to 3
    expect(shown.find((s) => s.id === "business-boosters")?.heightLevel).toBe(3);
  });

  it("never adds heightLevel for a widget without heightLevels", () => {
    const saved: StoredLayout = { visible: [{ id: "kpi-sales", span: 1, heightLevel: 2 }], dismissed: [] };
    const { shown } = resolveLayout(saved, user());
    expect(shown.find((s) => s.id === "kpi-sales")).toEqual({ id: "kpi-sales", span: 1 });
  });
});

describe("addWidget — heightLevel round-trip", () => {
  it("restores a remembered heightLevel when re-adding a dismissed widget", () => {
    const layout: StoredLayout = {
      visible: [],
      dismissed: [{ id: "recent-bills", span: 2, heightLevel: 3 }],
    };
    const after = addWidget(layout, "recent-bills");
    expect(after.visible).toContainEqual({ id: "recent-bills", span: 2, heightLevel: 3 });
  });

  it("defaults heightLevel to the middle level for a never-shown height-capable widget", () => {
    const layout: StoredLayout = { visible: [], dismissed: [] };
    const after = addWidget(layout, "stock-health");
    // stock-health heightLevels: [3, 6, 10] → middle index 2
    expect(after.visible).toContainEqual({ id: "stock-health", span: 2, heightLevel: 2 });
  });

  it("adding a widget without heightLevels never sets heightLevel", () => {
    const layout: StoredLayout = { visible: [], dismissed: [] };
    const after = addWidget(layout, "quick-actions");
    expect(after.visible).toContainEqual({ id: "quick-actions", span: 1 });
  });
});
