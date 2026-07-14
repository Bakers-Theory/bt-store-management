import { describe, it, expect } from "vitest";
import { categoryPL, stockHealth, recommendations, bucketSeries } from "./analytics";
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

const bread: Item = { id: "i1", name: "Bread", emoji: "🍞", category: "Breads", unit: "pcs", price: 40, costPrice: 20, qty: 5, tracksExpiry: true, earliestExpiry: null, batches: [] };
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

describe("bucketSeries", () => {
  const now = new Date("2026-07-14T12:00:00");

  it("fills a bounded 7-day range with weekday labels, oldest to newest", () => {
    const res = bucketSeries(
      [{ date: "2026-07-14", total: 100 }],
      { from: "2026-07-08", to: "2026-07-14" },
      now,
    );
    expect(res).toHaveLength(7);
    expect(res[6].total).toBe(100);
    expect(res.slice(0, 6).every((b) => b.total === 0)).toBe(true);
    expect(res[6].label).toMatch(/^[A-Z][a-z]{2}$/); // weekday e.g. "Tue"
  });

  it("uses daily buckets for a range of 31 days or fewer", () => {
    const res = bucketSeries([], { from: "2026-06-15", to: "2026-07-14" }, now);
    expect(res).toHaveLength(30);
  });

  it("switches to weekly buckets beyond 31 days", () => {
    const res = bucketSeries([], { from: "2026-01-01", to: "2026-12-31" }, now);
    // 365 days -> ceil(365/7) = 53 weekly buckets
    expect(res).toHaveLength(53);
  });

  it("derives bounds from the data when range is all-time (null bounds)", () => {
    const res = bucketSeries(
      [{ date: "2026-07-10", total: 50 }, { date: "2026-07-12", total: 70 }],
      { from: null, to: null },
      now,
    );
    expect(res).toHaveLength(3); // 10,11,12
    expect(res[0].total).toBe(50);
    expect(res[2].total).toBe(70);
  });

  it("returns an empty array for all-time with no data", () => {
    expect(bucketSeries([], { from: null, to: null }, now)).toEqual([]);
  });

  it("honors a from-only range, deriving the end from the data", () => {
    const res = bucketSeries(
      [{ date: "2026-07-10", total: 5 }, { date: "2026-07-12", total: 7 }],
      { from: "2026-07-10", to: null },
      now,
    );
    expect(res).toHaveLength(3); // 10,11,12
    expect(res.map((b) => b.total)).toEqual([5, 0, 7]);
  });

  it("honors a to-only range, deriving the start from the data", () => {
    const res = bucketSeries(
      [{ date: "2026-07-10", total: 5 }, { date: "2026-07-12", total: 7 }],
      { from: null, to: "2026-07-12" },
      now,
    );
    expect(res).toHaveLength(3);
    expect(res.map((b) => b.total)).toEqual([5, 0, 7]);
  });

  it("uses daily buckets at exactly 31 days and weekly at 32", () => {
    const daily31 = bucketSeries([], { from: "2026-06-14", to: "2026-07-14" }, now);
    expect(daily31).toHaveLength(31);
    const weekly32 = bucketSeries([], { from: "2026-06-13", to: "2026-07-14" }, now);
    expect(weekly32).toHaveLength(5); // ceil(32/7)
  });
});
