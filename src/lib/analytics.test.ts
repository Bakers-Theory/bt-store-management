import { describe, it, expect } from "vitest";
import { weeklyBuckets, categoryPL, stockHealth, recommendations } from "./analytics";
import type { Bill, Item } from "./types";

function bill(partial: Partial<Bill>): Bill {
  return {
    id: partial.id ?? "b1",
    billNo: partial.billNo ?? 1001,
    customerName: partial.customerName ?? "X",
    customerPhone: partial.customerPhone ?? "",
    items: partial.items ?? [],
    subtotal: partial.subtotal ?? 0,
    tax: partial.tax ?? 0,
    total: partial.total ?? 0,
    taxRate: partial.taxRate ?? 5,
    date: partial.date ?? "2026-07-03T10:00:00.000Z",
    status: partial.status ?? "active",
  } as Bill;
}

describe("weeklyBuckets", () => {
  it("returns 7 buckets oldest to newest ending today, filling from daily totals", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const res = weeklyBuckets([{ date: "2026-07-03", total: 100 }], now);
    expect(res).toHaveLength(7);
    expect(res[6].total).toBe(100); // today is last bucket
  });
  it("leaves days with no sales at zero", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const res = weeklyBuckets([], now);
    expect(res.every((b) => b.total === 0)).toBe(true);
  });
});

const bread: Item = { id: "i1", name: "Bread", emoji: "🍞", category: "Breads", unit: "pcs", price: 40, costPrice: 20, qty: 5 };
const breadLine = { itemId: "i1", name: "Bread", emoji: "🍞", unit: "pcs", qty: 2, price: 40, costPrice: 20 };

describe("categoryPL", () => {
  it("computes revenue, cogs, profit, margin and share per category (active only)", () => {
    const bills = [
      bill({ id: "b1", items: [breadLine], total: 80 }),
      bill({ id: "b2", status: "cancelled", items: [breadLine], total: 80 }),
    ];
    const res = categoryPL(bills, [bread]);
    expect(res).toEqual([
      { category: "Breads", revenue: 80, cogs: 40, profit: 40, marginPct: 50, sharePct: 100 },
    ]);
  });
});

describe("stockHealth", () => {
  it("marks unsold in-stock items as dead and computes days of cover for sellers", () => {
    const cake: Item = { ...bread, id: "i2", name: "Cake", category: "Cakes", qty: 3 };
    const bills = [
      bill({ id: "b1", items: [breadLine], date: "2026-06-01T10:00:00.000Z" }),
      bill({ id: "b2", billNo: 1002, items: [breadLine], date: "2026-06-02T10:00:00.000Z" }),
    ];
    const res = stockHealth(bills, [{ ...bread, qty: 20 }, cake], 2);
    const b = res.find((r) => r.item.name === "Bread")!;
    expect(b.sold).toBe(4); // 2-day span, 4 units => 2/day => 10 days cover
    expect(b.daysCover).toBe(10);
    expect(b.verdict).toBe("Healthy");
    const c = res.find((r) => r.item.name === "Cake")!;
    expect(c.verdict).toBe("Dead stock");
    expect(c.daysCover).toBeNull();
  });

  it("flags low-stock sellers as Reorder now", () => {
    const res = stockHealth([bill({ id: "b1", items: [breadLine] })], [bread], 5);
    expect(res[0].verdict).toBe("Reorder now");
  });
});

describe("recommendations", () => {
  it("returns a placeholder when there is no data", () => {
    const res = recommendations([], [], 5, "₹");
    expect(res).toHaveLength(1);
    expect(res[0].insight).toBe("Not enough data yet");
  });

  it("surfaces a high-priority reorder recommendation", () => {
    const res = recommendations([bill({ id: "b1", items: [breadLine] })], [bread], 5, "₹");
    const reorder = res.find((r) => r.priority === "High" && r.insight.includes("Reorder"));
    expect(reorder).toBeDefined();
    expect(reorder!.detail).toContain("Bread");
  });
});
