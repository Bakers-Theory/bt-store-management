import { describe, it, expect } from "vitest";
import { computeTotals, shortfallFor } from "./bill";
import type { BillLine } from "./types";

const line = (qty: number, price: number): BillLine => ({
  itemId: "x", name: "x", emoji: "📦", imageUrl: null, unit: "pcs", qty, price, costPrice: 0,
  hsn: "", gstRate: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0,
});

describe("computeTotals", () => {
  it("sums qty*price with no tax", () => {
    expect(computeTotals([line(2, 50), line(1, 30)], 0)).toEqual({
      subtotal: 130, discount: 0, tax: 0, total: 130,
    });
  });
  it("applies a percentage tax", () => {
    expect(computeTotals([line(1, 100)], 5)).toEqual({
      subtotal: 100, discount: 0, tax: 5, total: 105,
    });
  });
  it("is zero for an empty bill", () => {
    expect(computeTotals([], 18)).toEqual({ subtotal: 0, discount: 0, tax: 0, total: 0 });
  });
  it("deducts a percentage discount from the subtotal before tax", () => {
    // 100 − 10% = 90 taxable; 5% tax = 4.5; total 94.5
    expect(computeTotals([line(1, 100)], 5, 10)).toEqual({
      subtotal: 100, discount: 10, tax: 4.5, total: 94.5,
    });
  });
  it("adds charged consumables to the subtotal", () => {
    const bag = {
      consumableId: "c1", name: "Carry bag", unit: "pcs",
      qty: 2, unitCost: 5, charged: true, hsn: "", gstRate: 0,
    };
    expect(computeTotals([line(1, 100)], 0, 0, "percent", [bag])).toEqual({
      subtotal: 110, discount: 0, tax: 0, total: 110,
    });
  });

  it("ignores absorbed consumables entirely", () => {
    const wrap = {
      consumableId: "c2", name: "Foil wrap", unit: "pcs",
      qty: 2, unitCost: 5, charged: false, hsn: "", gstRate: 0,
    };
    expect(computeTotals([line(1, 100)], 0, 0, "percent", [wrap])).toEqual({
      subtotal: 100, discount: 0, tax: 0, total: 100,
    });
  });

  it("taxes and discounts a charged consumable like an item line", () => {
    const bag = {
      consumableId: "c1", name: "Carry bag", unit: "pcs",
      qty: 1, unitCost: 10, charged: true, hsn: "", gstRate: 0,
    };
    // subtotal 110, 10% off -> 99 taxable, 5% tax -> 4.95, total 103.95.
    expect(computeTotals([line(1, 100)], 5, 10, "percent", [bag])).toEqual({
      subtotal: 110, discount: 11, tax: 4.95, total: 103.95,
    });
  });
});

describe("computeTotals — non-GST bills charge no tax", () => {
  // From migration 0069 on, every new bill passes rate 0 here: a non-GST
  // invoice charges nothing, and a GST one is priced by computeGstTotals
  // instead. These pin the behaviour the bill screen now depends on.
  it("is subtotal minus discount when the rate is zero", () => {
    expect(computeTotals([line(1, 100)], 0, 10)).toEqual({
      subtotal: 100, discount: 10, tax: 0, total: 90,
    });
  });
  it("charges no tax on a flat discount either", () => {
    expect(computeTotals([line(1, 100)], 0, 25, "flat")).toEqual({
      subtotal: 100, discount: 25, tax: 0, total: 75,
    });
  });
});

describe("shortfallFor", () => {
  it("is the gap when the customer pays less than the total", () => {
    expect(shortfallFor(72, 70)).toBe(2);
  });
  it("is zero on exact payment", () => {
    expect(shortfallFor(72, 72)).toBe(0);
  });
  it("is zero on an overpayment — that is change due, not a loss", () => {
    expect(shortfallFor(72, 80)).toBe(0);
  });
  it("is the whole total when nothing was received", () => {
    expect(shortfallFor(72, 0)).toBe(72);
  });
  it("treats a blank entry (null) as paid in full", () => {
    expect(shortfallFor(72, null)).toBe(0);
  });
  it("treats a non-finite amount as paid in full", () => {
    expect(shortfallFor(72, NaN)).toBe(0);
  });
  it("clamps a negative received amount to the total", () => {
    expect(shortfallFor(72, -5)).toBe(72);
  });
  it("rounds the gap to two decimals", () => {
    expect(shortfallFor(72.55, 70.1)).toBe(2.45);
  });
});
