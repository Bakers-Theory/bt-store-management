import { round2 } from "./salary";
import type {
  ExpenseBankMode,
  ExpenseMode,
  ExpenseStatus,
} from "./types";

/**
 * Pure expense arithmetic, validation and workflow.
 *
 * The status transition table and the split validation are MIRRORS of the checks
 * in `0052_expense_rpcs.sql`. The SQL copy is the authority — this exists so a
 * form can disable a button and show an error before a round trip. Same rule as
 * `attendance.ts`/`attendance_summary` and `salary.ts`/`payroll_compute`.
 */

export const EXPENSE_MODES: ExpenseMode[] = ["Cash", "UPI", "Bank Transfer", "Mixed"];

/** The bank leg of a Mixed payment. The cash leg is always `Cash`. */
export const BANK_SPLIT_MODES: ExpenseBankMode[] = ["UPI", "Bank Transfer"];

export const EXPENSE_STATUSES: ExpenseStatus[] = [
  "pending",
  "paid",
  "rejected",
  "cancelled",
];

/**
 * GST is INCLUDED in `amount`, never added to it — `amount` is the gross figure
 * that posts to cash, because the tax was paid too. The base is derived.
 */
export function gstSplit(
  amount: number,
  gstIncluded: boolean,
  gstAmount: number,
): { base: number; gst: number } {
  // The flag is the authority: a leftover figure from a toggled-off checkbox
  // must not silently apply.
  if (!gstIncluded) return { base: round2(amount), gst: 0 };
  const gst = round2(gstAmount);
  return { base: round2(amount - gst), gst };
}

/** Paise, in rupees — the tolerance for float drift in a sum check. */
const EPSILON = 0.005;

/**
 * Validates a Mixed payment's two legs. Returns an error message, or null when
 * the split is good.
 */
export function splitError(
  amount: number,
  splitCash: number,
  splitBank: number,
): string | null {
  if (splitCash <= 0 || splitBank <= 0) {
    return "A mixed payment needs both a cash and a bank amount, each more than zero";
  }
  if (Math.abs(splitCash + splitBank - amount) > EPSILON) {
    return "The cash and bank amounts must add up to the total";
  }
  return null;
}

/**
 * Two paths, one hop each. Someone who can pay records a paid expense directly;
 * everyone else records one for approval.
 */
export function statusOnCreate(canPay: boolean): ExpenseStatus {
  return canPay ? "paid" : "pending";
}

export interface ExpensePerms {
  canPay: boolean;
  canCancel: boolean;
}

/**
 * The legal transitions, and who may make them. Nothing settled ever reopens:
 * a paid expense is cancelled (which reverses the cash), a rejected one is
 * re-recorded.
 */
export function canTransition(
  from: ExpenseStatus,
  to: ExpenseStatus,
  perms: ExpensePerms,
): boolean {
  if (from === "pending" && to === "paid") return perms.canPay;
  if (from === "pending" && to === "rejected") return perms.canPay;
  if (from === "paid" && to === "cancelled") return perms.canCancel;
  // pending → cancelled is deliberately absent: an unpaid expense is REJECTED.
  // Cancelling means "we paid this and shouldn't have".
  return false;
}

export function expenseStatusLabel(s: ExpenseStatus): string {
  switch (s) {
    case "pending":
      return "Pending approval";
    case "paid":
      return "Paid";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
  }
}

export function expenseStatusTone(s: ExpenseStatus): "warn" | "good" | "bad" | "muted" {
  switch (s) {
    case "pending":
      return "warn";
    case "paid":
      return "good";
    case "rejected":
      return "bad";
    case "cancelled":
      return "muted";
  }
}

/**
 * A warning, not a constraint: one supplier invoice legitimately splits across
 * two expense records, so this informs rather than blocks (#32 asks for a
 * warning). Blank is never a duplicate — most expenses carry no invoice number.
 */
export function isDuplicateInvoice(invoiceNo: string, existing: string[]): boolean {
  const key = invoiceNo.trim().toLowerCase();
  if (key === "") return false;
  return existing.some((e) => e.trim().toLowerCase() === key);
}
