import { describe, it, expect } from "vitest";
import { weeklySales, topItems, categoryRevenue } from "./analytics";
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

describe("weeklySales", () => {
  it("returns 7 buckets oldest to newest ending today", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const res = weeklySales([bill({ total: 100, date: "2026-07-03T09:00:00.000Z" })], now);
    expect(res).toHaveLength(7);
    expect(res[6].total).toBe(100); // today is last bucket
  });
  it("excludes cancelled bills", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const res = weeklySales([bill({ total: 100, status: "cancelled", date: "2026-07-03T09:00:00.000Z" })], now);
    expect(res[6].total).toBe(0);
  });
});

describe("topItems", () => {
  it("ranks items by quantity sold, descending, capped", () => {
    const b = bill({
      items: [
        { itemId: "i1", name: "Croissant", emoji: "🥐", unit: "pcs", qty: 2, price: 45, costPrice: 20 },
        { itemId: "i2", name: "Donut", emoji: "🍩", unit: "pcs", qty: 5, price: 40, costPrice: 15 },
      ],
    });
    const res = topItems([b], 5);
    expect(res[0]).toEqual({ name: "Donut", qty: 5 });
    expect(res[1]).toEqual({ name: "Croissant", qty: 2 });
  });
});

describe("categoryRevenue", () => {
  it("sums revenue per category", () => {
    const items: Item[] = [
      { id: "i1", name: "Croissant", emoji: "🥐", category: "Pastries", unit: "pcs", price: 45, costPrice: 20, qty: 10 },
    ];
    const b = bill({
      items: [{ itemId: "i1", name: "Croissant", emoji: "🥐", unit: "pcs", qty: 2, price: 45, costPrice: 20 }],
    });
    const res = categoryRevenue([b], items);
    expect(res).toEqual([{ category: "Pastries", revenue: 90 }]);
  });
});
