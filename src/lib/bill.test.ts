import { describe, it, expect } from "vitest";
import { computeTotals } from "./bill";
import type { BillLine } from "./types";

const line = (qty: number, price: number): BillLine => ({
  itemId: "x", name: "x", emoji: "📦", unit: "pcs", qty, price, costPrice: 0,
});

describe("computeTotals", () => {
  it("sums qty*price with no tax", () => {
    expect(computeTotals([line(2, 50), line(1, 30)], 0)).toEqual({
      subtotal: 130, tax: 0, total: 130,
    });
  });
  it("applies a percentage tax", () => {
    expect(computeTotals([line(1, 100)], 5)).toEqual({
      subtotal: 100, tax: 5, total: 105,
    });
  });
  it("is zero for an empty bill", () => {
    expect(computeTotals([], 18)).toEqual({ subtotal: 0, tax: 0, total: 0 });
  });
});
