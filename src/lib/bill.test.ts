import { describe, it, expect } from "vitest";
import { computeTotals, shortfallFor } from "./bill";
import type { BillLine } from "./types";

const line = (qty: number, price: number): BillLine => ({
  itemId: "x", name: "x", emoji: "📦", imageUrl: null, unit: "pcs", qty, price, costPrice: 0,
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
