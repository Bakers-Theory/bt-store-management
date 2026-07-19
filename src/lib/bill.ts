import type { BillLine } from "./types";

export interface BillTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Subtotal / discount / tax / total for a set of bill lines. The discount is
 * deducted from the subtotal before tax; `discount` is the amount deducted.
 * `discountValue` is a percentage (0–100) when `discountMode` is "percent", or a
 * flat ₹ amount (clamped to the subtotal) when "flat". Rounds at each step
 * (mirroring generate_bill's server-side rounding) so this preview always
 * matches the receipt's total to the cent.
 */
export function computeTotals(
  lines: BillLine[],
  taxRate: number,
  discountValue = 0,
  discountMode: "percent" | "flat" = "percent",
): BillTotals {
  const subtotal = round2(lines.reduce((s, bi) => s + bi.qty * bi.price, 0));
  const rawDiscount =
    discountMode === "flat"
      ? Math.min(subtotal, Math.max(0, discountValue))
      : (subtotal * discountValue) / 100;
  const discount = round2(rawDiscount);
  const taxable = round2(subtotal - rawDiscount);
  const tax = round2((taxable * taxRate) / 100);
  const total = round2(taxable + tax);
  return { subtotal, discount, tax, total };
}
