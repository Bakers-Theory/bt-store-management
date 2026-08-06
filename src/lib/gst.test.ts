import { describe, it, expect } from "vitest";
import {
  financialYear, isValidGstin, stateCodeFromGstin, allocateDiscount,
  computeGstTotals, hsnSummary, amountInWords,
} from "./gst";
import type { GstLine, GstOptions } from "./gst";

const line = (qty: number, price: number, gstRate: number, hsn = "1905", name = "Cake"): GstLine =>
  ({ qty, price, gstRate, hsn, name });

const opts = (o: Partial<GstOptions> = {}): GstOptions => ({
  pricesIncludeGst: true, interstate: false,
  discountValue: 0, discountMode: "percent", ...o,
});

describe("financialYear", () => {
  it("puts 31 March in the year that is ending", () => {
    expect(financialYear(new Date("2027-03-31T18:00:00Z"), "Asia/Kolkata")).toBe("2026-27");
  });
  it("puts 1 April in the year that is starting", () => {
    expect(financialYear(new Date("2027-04-01T04:00:00Z"), "Asia/Kolkata")).toBe("2027-28");
  });
  it("uses the store timezone, not UTC", () => {
    // 2027-03-31 20:00 UTC is already 2027-04-01 01:30 in Kolkata.
    expect(financialYear(new Date("2027-03-31T20:00:00Z"), "Asia/Kolkata")).toBe("2027-28");
    expect(financialYear(new Date("2027-03-31T20:00:00Z"), "UTC")).toBe("2026-27");
  });
});

describe("isValidGstin / stateCodeFromGstin", () => {
  it("accepts a well-formed GSTIN", () => {
    expect(isValidGstin("29ABCDE1234F1Z5")).toBe(true);
  });
  it("rejects a short one, a lowercase one and a blank", () => {
    expect(isValidGstin("29ABCDE1234F1Z")).toBe(false);
    expect(isValidGstin("29abcde1234f1z5")).toBe(false);
    expect(isValidGstin("")).toBe(false);
  });
  it("rejects one without Z in position 14", () => {
    expect(isValidGstin("29ABCDE1234F1A5")).toBe(false);
  });
  it("reads the state code off the first two characters", () => {
    expect(stateCodeFromGstin("29ABCDE1234F1Z5")).toBe("29");
  });
  it("gives an empty state code for a malformed GSTIN", () => {
    expect(stateCodeFromGstin("nonsense")).toBe("");
  });
});

describe("allocateDiscount", () => {
  it("splits pro-rata by line amount", () => {
    expect(allocateDiscount([100, 300], 40)).toEqual([10, 30]);
  });
  it("gives the residue paisa to the last line so the parts sum to the whole", () => {
    const parts = allocateDiscount([10, 10, 10], 10);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(10);
    expect(parts).toEqual([3.33, 3.33, 3.34]);
  });
  it("is all zeros when there is no discount", () => {
    expect(allocateDiscount([100, 50], 0)).toEqual([0, 0]);
  });
  it("is all zeros when every line is zero", () => {
    expect(allocateDiscount([0, 0], 10)).toEqual([0, 0]);
  });
  it("allocates the whole subtotal on a 100% discount", () => {
    expect(allocateDiscount([100, 50], 150)).toEqual([100, 50]);
  });
});

describe("computeGstTotals — inclusive pricing", () => {
  it("backs the tax out of a 18% inclusive price", () => {
    const t = computeGstTotals([line(1, 118, 18)], opts());
    expect(t.subtotal).toBe(118);
    expect(t.taxable).toBe(100);
    expect(t.cgst).toBe(9);
    expect(t.sgst).toBe(9);
    expect(t.igst).toBe(0);
    expect(t.tax).toBe(18);
    expect(t.total).toBe(118);
  });
  it("charges nothing at 0%", () => {
    const t = computeGstTotals([line(2, 50, 0)], opts());
    expect(t.taxable).toBe(100);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(100);
  });
  it("keeps taxable + tax exactly equal to the inclusive amount at 5/12/28%", () => {
    for (const rate of [5, 12, 28]) {
      const t = computeGstTotals([line(3, 33.33, rate)], opts());
      expect(+(t.taxable + t.tax).toFixed(2)).toBe(t.total);
      expect(t.total).toBe(99.99);
    }
  });
});

describe("computeGstTotals — exclusive pricing", () => {
  it("adds the tax on top", () => {
    const t = computeGstTotals([line(1, 100, 18)], opts({ pricesIncludeGst: false }));
    expect(t.subtotal).toBe(100);
    expect(t.taxable).toBe(100);
    expect(t.tax).toBe(18);
    expect(t.total).toBe(118);
  });
  it("rounds the tax to two decimals", () => {
    const t = computeGstTotals([line(1, 33.33, 5)], opts({ pricesIncludeGst: false }));
    expect(t.tax).toBe(1.67);
    expect(t.total).toBe(35);
  });
});

describe("computeGstTotals — interstate", () => {
  it("puts the whole tax in IGST", () => {
    const t = computeGstTotals([line(1, 118, 18)], opts({ interstate: true }));
    expect(t.igst).toBe(18);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
  });
  it("gives the odd paisa to CGST intra-state so cgst + sgst equals the tax", () => {
    // ₹100 inclusive at 18% backs out to taxable 84.75 and tax 15.25 — an ODD
    // number of paise, so the halves cannot both be exact. CGST takes the extra.
    const t = computeGstTotals([line(1, 100, 18)], opts());
    expect(t.tax).toBe(15.25);
    expect(t.cgst).toBe(7.63);
    expect(t.sgst).toBe(7.62);
    expect(+(t.cgst + t.sgst).toFixed(2)).toBe(t.tax);
  });
});

describe("computeGstTotals — mixed basket and discounts", () => {
  it("makes the invoice totals the sum of the line values", () => {
    const t = computeGstTotals(
      [line(1, 118, 18, "1905"), line(2, 52.5, 5, "2106"), line(1, 100, 0, "0401")],
      opts(),
    );
    const sum = (f: (l: (typeof t.lines)[number]) => number) =>
      +t.lines.reduce((s, l) => s + f(l), 0).toFixed(2);
    expect(t.taxable).toBe(sum((l) => l.taxable));
    expect(t.cgst).toBe(sum((l) => l.cgst));
    expect(t.sgst).toBe(sum((l) => l.sgst));
    expect(t.tax).toBe(sum((l) => l.tax));
    expect(t.total).toBe(sum((l) => l.total));
  });
  it("deducts a percent discount from the taxable value before tax", () => {
    const t = computeGstTotals([line(1, 118, 18)], opts({ discountValue: 10 }));
    expect(t.discount).toBe(11.8);
    expect(t.total).toBe(106.2);
    expect(+(t.taxable + t.tax).toFixed(2)).toBe(106.2);
  });
  it("clamps a flat discount to the subtotal", () => {
    const t = computeGstTotals([line(1, 118, 18)], opts({ discountMode: "flat", discountValue: 500 }));
    expect(t.discount).toBe(118);
    expect(t.taxable).toBe(0);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(0);
  });
  it("zeroes everything on a 100% discount", () => {
    const t = computeGstTotals([line(1, 118, 18), line(1, 50, 5)], opts({ discountValue: 100 }));
    expect(t.total).toBe(0);
    expect(t.tax).toBe(0);
  });
  it("is all zeros for an empty basket", () => {
    const t = computeGstTotals([], opts());
    expect(t).toMatchObject({ subtotal: 0, discount: 0, taxable: 0, tax: 0, total: 0 });
    expect(t.lines).toEqual([]);
  });
});

describe("hsnSummary", () => {
  it("groups by HSN and rate and reconciles with the invoice totals", () => {
    const t = computeGstTotals(
      [line(1, 118, 18, "1905"), line(1, 236, 18, "1905"), line(2, 52.5, 5, "2106")],
      opts(),
    );
    const rows = hsnSummary(t.lines);
    expect(rows).toHaveLength(2);
    const cake = rows.find((r) => r.hsn === "1905")!;
    expect(cake.gstRate).toBe(18);
    expect(cake.qty).toBe(2);
    expect(+rows.reduce((s, r) => s + r.taxable, 0).toFixed(2)).toBe(t.taxable);
    expect(+rows.reduce((s, r) => s + r.cgst, 0).toFixed(2)).toBe(t.cgst);
  });
  it("keeps the same HSN at two rates as two rows", () => {
    const t = computeGstTotals([line(1, 105, 5, "1905"), line(1, 118, 18, "1905")], opts());
    expect(hsnSummary(t.lines)).toHaveLength(2);
  });
});

describe("amountInWords", () => {
  it("writes units and tens", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
    expect(amountInWords(7)).toBe("Seven Rupees Only");
    expect(amountInWords(19)).toBe("Nineteen Rupees Only");
    expect(amountInWords(90)).toBe("Ninety Rupees Only");
  });
  it("writes hundreds and thousands", () => {
    expect(amountInWords(101)).toBe("One Hundred One Rupees Only");
    expect(amountInWords(1500)).toBe("One Thousand Five Hundred Rupees Only");
  });
  it("uses the Indian lakh and crore groupings", () => {
    expect(amountInWords(125000)).toBe("One Lakh Twenty Five Thousand Rupees Only");
    expect(amountInWords(10000000)).toBe("One Crore Rupees Only");
  });
  it("writes the paisa", () => {
    expect(amountInWords(118.5)).toBe("One Hundred Eighteen Rupees and Fifty Paise Only");
    expect(amountInWords(0.05)).toBe("Zero Rupees and Five Paise Only");
  });
});
