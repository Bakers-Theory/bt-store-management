import type { BillLine } from "./types";

export interface BillTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/**
 * Subtotal / discount / tax / total for a set of bill lines. The discount (%)
 * is deducted from the subtotal before tax; `discount` is the amount deducted.
 */
export function computeTotals(
  lines: BillLine[],
  taxRate: number,
  discountPct = 0,
): BillTotals {
  const subtotal = lines.reduce((s, bi) => s + bi.qty * bi.price, 0);
  const discount = (subtotal * discountPct) / 100;
  const taxable = subtotal - discount;
  const tax = (taxable * taxRate) / 100;
  const total = taxable + tax;
  return { subtotal, discount, tax, total };
}
