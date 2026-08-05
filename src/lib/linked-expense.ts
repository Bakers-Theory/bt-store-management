import { round2 } from "./salary";
import type { LinkedExpenseInput, LinkedExpenseMode } from "./types";

/**
 * The cash book block a purchase form attaches to what it is recording
 * (migration 0066).
 *
 * `linkedExpenseError` is a MIRROR of the checks in `record_linked_expense`. The
 * SQL copy is the authority — this exists so a form can disable its button and
 * say what is missing before a round trip, the same rule `expense.ts` and
 * `cashbook.ts` follow.
 *
 * The one thing this side must NOT own is the amount. The server derives it from
 * the record itself — quantity × unit cost, the purchase price, the repair cost —
 * so `draftToInput` never sends a figure at all. A form passes the amount here
 * only so the GST check has something to compare against.
 */

/** Note 5 of 0066: one mode. `Mixed` belongs to the Expenses register. */
export const LINKED_EXPENSE_MODES: LinkedExpenseMode[] = [
  "Cash",
  "UPI",
  "Bank Transfer",
];

export interface LinkedExpenseDraft {
  /**
   * Whether to record the spend at all. Off saves the stock or the asset with no
   * expense against it — the pre-0066 behaviour, and the only thing available to
   * someone without `expense.create`.
   */
  record: boolean;
  categoryId: string;
  paymentMode: LinkedExpenseMode;
  /** Only used when `pay` is on. */
  paidOn: string;
  pay: boolean;
  vendorName: string;
  vendorSupplierId: string;
  invoiceNo: string;
  gstIncluded: boolean;
  /** As typed, so an empty box is distinguishable from a zero. */
  gstAmount: string;
}

/**
 * `record` follows the permission and `pay` follows `expense.pay`: whoever can
 * pay is recording a purchase that has been paid for, and whoever cannot leaves
 * it for approval.
 */
export function emptyLinkedExpense(
  today: string,
  perms: { canRecord: boolean; canPay: boolean },
  seed: Partial<LinkedExpenseDraft> = {},
): LinkedExpenseDraft {
  return {
    record: perms.canRecord,
    categoryId: "",
    paymentMode: "Cash",
    paidOn: today,
    pay: perms.canPay,
    vendorName: "",
    vendorSupplierId: "",
    invoiceNo: "",
    gstIncluded: false,
    gstAmount: "",
    ...seed,
  };
}

/**
 * Everything `record_linked_expense` would reject, in the order it rejects it.
 * Returns null when the block is off — an absent spend is never an error.
 */
export function linkedExpenseError(
  draft: LinkedExpenseDraft,
  amount: number,
  today: string,
): string | null {
  if (!draft.record) return null;

  if (!Number.isFinite(amount) || round2(amount) <= 0) {
    return "Enter what this cost, so it can be recorded in the cash book";
  }
  if (draft.categoryId === "") return "Choose a cash book category for this spend";
  if (draft.gstIncluded) {
    const gst = Number(draft.gstAmount || 0);
    if (!Number.isFinite(gst) || gst < 0 || gst >= amount) {
      return "The GST is inside the total, so it has to be less than it";
    }
  }
  if (draft.pay) {
    if (draft.paidOn === "") return "When was this paid?";
    if (draft.paidOn > today) return "A payment date cannot be in the future";
  }
  return null;
}

/**
 * The payload, or `null` for "record nothing" — which is what the RPCs read as
 * "stock only". A caller passes the result straight through; it must not
 * substitute an empty object, because the server treats any object as a request
 * to post.
 */
export function draftToInput(draft: LinkedExpenseDraft): LinkedExpenseInput | null {
  if (!draft.record) return null;
  return {
    categoryId: draft.categoryId,
    paymentMode: draft.paymentMode,
    paidOn: draft.pay ? draft.paidOn : "",
    pay: draft.pay,
    vendorName: draft.vendorName.trim(),
    vendorSupplierId: draft.vendorSupplierId || null,
    invoiceNo: draft.invoiceNo.trim(),
    gstIncluded: draft.gstIncluded,
    gstAmount: draft.gstIncluded ? round2(Number(draft.gstAmount || 0)) : 0,
    description: "",
  };
}

/** What the button should say once a spend is attached. */
export function linkedExpenseSummary(
  draft: LinkedExpenseDraft,
  amount: number,
  currency: string,
): string {
  if (!draft.record) return "No cash book entry";
  const money = `${currency}${round2(amount).toLocaleString("en-IN")}`;
  return draft.pay
    ? `${money} out of ${draft.paymentMode === "Cash" ? "cash in hand" : "the bank"}`
    : `${money} held for approval`;
}
