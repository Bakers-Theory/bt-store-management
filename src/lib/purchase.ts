/**
 * Purchase arithmetic, mirrored by the SQL in `0037`–`0039`. SQL is the
 * authority — this exists so the purchase form can total an invoice and refuse
 * an impossible return without a round trip, the same arrangement as
 * `advance.ts` against `0032_staff_advance.sql`.
 *
 * Nothing here is ever persisted as a stored aggregate: outstanding balance,
 * total purchases and last purchase date are all view-computed server-side.
 * These functions exist to display and to pre-validate, not to be a second
 * source of truth (NFR-1).
 */
import { round2 } from "./salary";
import type { PurchaseMode, SupplierSummary, SupplierType } from "./types";

export const PURCHASE_MODES: PurchaseMode[] = ["Cash", "UPI", "Bank Transfer", "Cheque"];

export const isPurchaseMode = (v: unknown): v is PurchaseMode =>
  typeof v === "string" && (PURCHASE_MODES as string[]).includes(v);

/** A line being entered, before it has an id. */
export interface DraftLine {
  itemId: string;
  qty: number;
  unitCost: number;
  /** Percent. Must be 0 on an in-house receipt. */
  gstRate: number;
  expiry: string | null;
}

export const lineTotal = (qty: number, unitCost: number): number => round2(qty * unitCost);

export const lineGst = (qty: number, unitCost: number, gstRate: number): number =>
  round2((lineTotal(qty, unitCost) * gstRate) / 100);

export interface InvoiceTotals {
  subtotal: number;
  /** Null for in-house: not zero. There is no GST on your own production. */
  gstAmount: number | null;
  total: number;
}

export function invoiceTotals(lines: DraftLine[], type: SupplierType): InvoiceTotals {
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l.qty, l.unitCost), 0));
  if (type === "in_house") {
    // Any rate the form happens to be holding is discarded, not summed: the
    // database refuses a non-null gst_amount on an in-house invoice outright.
    return { subtotal, gstAmount: null, total: subtotal };
  }
  const gstAmount = round2(lines.reduce((s, l) => s + lineGst(l.qty, l.unitCost, l.gstRate), 0));
  return { subtotal, gstAmount, total: round2(subtotal + gstAmount) };
}

/** How much of a purchased line is still returnable. Never negative. */
export const returnableQty = (purchased: number, alreadyReturned: number): number =>
  Math.max(0, round2(purchased - alreadyReturned));

export const isReturnQtyValid = (
  qty: number,
  purchased: number,
  alreadyReturned: number,
): boolean => qty > 0 && round2(qty) <= returnableQty(purchased, alreadyReturned);

/**
 * What is still owed. Unlike an advance balance this may go negative: an
 * overpayment or an over-credited return is a real state, and hiding it behind
 * a zero floor would make the figure disagree with the ledger below it.
 */
export const outstandingBalance = (
  totalPurchases: number,
  totalPayments: number,
  returnCredit: number,
): number => round2(totalPurchases - totalPayments - returnCredit);

export interface SupplierTotals {
  /** External suppliers with something still outstanding — not the whole list. */
  suppliersOwing: number;
  purchases: number;
  payments: number;
  returnCredit: number;
  outstanding: number;
  /** Reported on its own line; never folded into a payable. */
  inHouseValue: number;
}

const isExternal = (r: SupplierSummary) => r.supplierType === "external";

export function summaryTotals(rows: SupplierSummary[]): SupplierTotals {
  const ext = rows.filter(isExternal);
  const sum = (pick: (r: SupplierSummary) => number) =>
    round2(ext.reduce((s, r) => s + pick(r), 0));
  return {
    suppliersOwing: ext.filter((r) => r.outstanding > 0).length,
    purchases: sum((r) => r.totalPurchases),
    payments: sum((r) => r.totalPayments),
    returnCredit: sum((r) => r.returnCredit),
    outstanding: sum((r) => r.outstanding),
    inHouseValue: round2(
      rows.filter((r) => !isExternal(r)).reduce((s, r) => s + r.inHouseValue, 0),
    ),
  };
}

export interface InvoiceDraft {
  supplierId: string;
  supplierType: SupplierType;
  invoiceNo: string;
  purchaseDate: string; // "YYYY-MM-DD"
  lines: DraftLine[];
}

/**
 * Field name → message. An empty object means valid. `today` is passed in
 * rather than read from the clock so this stays pure and testable.
 */
export function validateInvoiceDraft(
  draft: InvoiceDraft,
  today: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const external = draft.supplierType === "external";

  if (!draft.supplierId) errors.supplierId = "Choose a supplier.";
  if (!draft.purchaseDate) {
    errors.purchaseDate = "Purchase date is required.";
  } else if (draft.purchaseDate > today) {
    errors.purchaseDate = "A purchase date cannot be in the future.";
  }

  if (external && !draft.invoiceNo.trim()) {
    errors.invoiceNo = "An external supplier's invoice number is required.";
  }
  if (!external && draft.invoiceNo.trim()) {
    errors.invoiceNo = "An in-house receipt has no supplier invoice number.";
  }

  if (draft.lines.length === 0) {
    errors.lines = "Add at least one product.";
  } else if (draft.lines.some((l) => !l.itemId)) {
    errors.lines = "Every line needs a product.";
  } else if (draft.lines.some((l) => !(l.qty > 0))) {
    errors.lines = "Every line needs a quantity above zero.";
  } else if (draft.lines.some((l) => l.unitCost < 0)) {
    errors.lines = "A unit cost cannot be negative.";
  } else if (external && draft.lines.some((l) => l.gstRate < 0 || l.gstRate > 100)) {
    errors.lines = "A GST rate must be between 0 and 100.";
  } else if (!external && draft.lines.some((l) => l.gstRate !== 0)) {
    errors.lines = "There is no GST on an in-house receipt.";
  }

  return errors;
}
