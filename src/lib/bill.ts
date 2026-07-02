import type { BillLine } from "./types";

export interface BillTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** Subtotal / tax / total for a set of bill lines at a given tax rate (%). */
export function computeTotals(lines: BillLine[], taxRate: number): BillTotals {
  const subtotal = lines.reduce((s, bi) => s + bi.qty * bi.price, 0);
  const tax = (subtotal * taxRate) / 100;
  const total = subtotal + tax;
  return { subtotal, tax, total };
}
