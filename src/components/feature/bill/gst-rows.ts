import type { GstLineResult } from "@/lib/gst";
import type { Bill } from "@/lib/types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The invoice lines of a GST bill, from STORED values only. Every line's tax was
 * computed by `generate_bill` and snapshotted at checkout; recomputing it here
 * could print a figure the customer was never charged.
 *
 * Charged consumables are supplies on the invoice; absorbed ones never reached
 * the customer and must not appear on it.
 *
 * Shared by both papers — the A4 `TaxInvoice` and the 80mm `TaxReceipt` — so the
 * two can never disagree about what was sold.
 */
export function gstRowsForBill(bill: Bill): GstLineResult[] {
  return [
    ...bill.items.map((i) => ({
      name: i.name,
      hsn: i.hsn,
      gstRate: i.gstRate,
      qty: i.qty,
      amount: round2(i.qty * i.price),
      discount: 0,
      taxable: i.taxableValue,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      tax: round2(i.cgst + i.sgst + i.igst),
      total: round2(i.taxableValue + i.cgst + i.sgst + i.igst),
    })),
    ...bill.consumables
      .filter((c) => c.charged)
      .map((c) => ({
        name: c.name,
        hsn: c.hsn,
        gstRate: c.gstRate,
        qty: c.qty,
        amount: round2(c.qty * c.unitCost),
        discount: 0,
        taxable: c.taxableValue,
        cgst: c.cgst,
        sgst: c.sgst,
        igst: c.igst,
        tax: round2(c.cgst + c.sgst + c.igst),
        total: round2(c.taxableValue + c.cgst + c.sgst + c.igst),
      })),
  ];
}
