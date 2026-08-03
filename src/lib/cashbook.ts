import { round2 } from "./salary";
import type {
  CashAccount,
  CashCategory,
  CashDirection,
  CashEntry,
  CashPaymentMode,
} from "./types";

/**
 * Pure cashbook labelling.
 *
 * `modeToAccount` is a MIRROR of `mode_to_account()` in SQL (migration 0045).
 * The SQL copy is the authority — this exists only so a form can tell the
 * operator which balance their choice will move, without a round trip. Same rule
 * as `attendance.ts`/`attendance_summary` and `salary.ts`/`payroll_compute`.
 *
 * Reconciliation arithmetic (expected cash, the counted difference) lands in
 * phase B alongside the day-close page that needs it. The running balance is
 * computed by `cash_entry_v` over the whole ledger, so there is deliberately no
 * client-side accumulator: one over a single page would be wrong.
 */

/** Modes a *new* entry may carry. `Cheque` is readable but never offered. */
export const ENTRY_MODES: CashPaymentMode[] = ["Cash", "UPI", "Bank Transfer"];

/** Every mode that can appear on a stored row, including legacy ones. */
export const CASH_PAYMENT_MODES: CashPaymentMode[] = [
  "Cash",
  "UPI",
  "Bank Transfer",
  "Cheque",
];

/** Physical cash is the drawer; every electronic mode lands in the bank. */
export function modeToAccount(mode: CashPaymentMode): CashAccount {
  return mode === "Cash" ? "cash" : "bank";
}

export function accountLabel(a: CashAccount): string {
  return a === "cash" ? "Cash in hand" : "Bank";
}

/**
 * "Is there enough to pay this?", for a form that already knows the live
 * balance. Returns the shortfall message, or null when the money is there.
 *
 * A MIRROR of assert_funds() in migration 0059, which is what actually refuses
 * the payment — this only saves the operator a round trip and a red toast.
 * `available` must be the live balance, not an as-of-the-date one, because that
 * is what the SQL side compares against.
 *
 * `excludeAmount` is the money-out row being edited: raising a 100 entry to 150
 * needs 50 more, not 150 more, so its own effect comes off the balance first.
 */
export function fundsShortfall(
  account: CashAccount,
  available: number,
  amount: number,
  excludeAmount = 0,
): string | null {
  if (!(amount > 0)) return null;
  const usable = available + excludeAmount;
  if (usable >= amount) return null;
  return `Not enough ${account === "cash" ? "cash in hand" : "money in the bank"} — ${usable.toLocaleString("en-IN")} available, this needs ${amount.toLocaleString("en-IN")}.`;
}

/**
 * The nine entry types from #32, derived rather than stored. A reversal reads as
 * a Refund whatever it reverses — that is what it is to the person holding the
 * money.
 */
export function entryTypeLabel(e: CashEntry): string {
  if (e.reversesId) return "Refund";
  switch (e.sourceType) {
    case "bill":
      return "POS Sale";
    case "expense":
      return "Cash Expense";
    case "salary":
      return "Salary Payment";
    case "advance":
      return "Staff Advance";
    case "supplier_payment":
      return "Vendor Payment";
    case "transfer":
      return "Transfer";
    case "opening":
      return "Opening Balance";
    case "manual":
      return e.categoryName === "Petty Cash" ? "Petty Cash" : "Manual Adjustment";
  }
}

// ─── Category selection ─────────────────────────────────────────────────────

export interface CategoryGroupOption {
  group: string;
  leaves: CashCategory[];
}

export interface PostableCategories {
  /** Top-level categories WITH children; postings file against a child. */
  groups: CategoryGroupOption[];
  /** Childless top-level categories, which are leaves in their own right. */
  flat: CashCategory[];
}

/**
 * The categories a posting may actually name, split into the two shapes the
 * schema supports.
 *
 * A childless top-level category IS a leaf, so `post_cash` accepts it —
 * `is_leaf_category()` only asks whether anything has it as a parent. A picker
 * that offered groups-with-children alone would therefore hide perfectly valid
 * categories, which is why this returns `flat` separately rather than filtering
 * to `parentId !== null`.
 *
 * System categories are excluded: they are filled in by the auto-posting paths
 * and `add_cash_entry` refuses them by hand.
 */
export function postableCategories(
  categories: CashCategory[],
  direction?: CashDirection,
): PostableCategories {
  const flows = (c: CashCategory) =>
    direction === undefined || c.direction === "both" || c.direction === direction;

  const user = categories.filter((c) => !c.isSystem);
  const hasChild = (id: string) => user.some((c) => c.parentId === id);

  const children = user.filter((c) => c.parentId !== null && flows(c));

  return {
    groups: user
      .filter((g) => g.parentId === null && hasChild(g.id))
      .map((g) => ({
        group: g.name,
        leaves: children.filter((l) => l.parentId === g.id),
      }))
      // A group whose every child flows the other way has nothing to offer.
      .filter((g) => g.leaves.length > 0),
    flat: user.filter((c) => c.parentId === null && !hasChild(c.id) && flows(c)),
  };
}

export interface CategoryTreeNode {
  category: CashCategory;
  children: CashCategory[];
}

/**
 * The whole tree, for the management panel.
 *
 * The counterpart to `postableCategories`, which answers a different question:
 * that one is for a PICKER, so it hides system categories and returns leaves
 * only. This one is for EDITING, so system categories are present (rendered
 * locked) and a childless group is kept (so you can add into it).
 *
 * A child whose parent is absent is dropped rather than promoted — it can only
 * mean the parent was archived out of `cash_category_v`, and showing an
 * archived group's children as top-level would be a lie.
 */
export function categoryTree(categories: CashCategory[]): CategoryTreeNode[] {
  // sortOrder is only unique per sibling set, and two rows added in the same
  // second can share it. The name tiebreak stops the list reordering between
  // renders.
  const byOrder = (a: CashCategory, b: CashCategory) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

  return categories
    .filter((c) => c.parentId === null)
    .sort(byOrder)
    .map((category) => ({
      category,
      children: categories.filter((c) => c.parentId === category.id).sort(byOrder),
    }));
}

// ─── Period labelling ───────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** "12 Jul" / "12 Jul 2025" — never via `new Date()`, which parses as UTC. */
function shortDate(ymd: string, currentYear: string): string {
  const [y, m, d] = ymd.split("-");
  const base = `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
  return y === currentYear ? base : `${base} ${y}`;
}

/**
 * The label for a range-scoped figure, e.g. "Today's sales" vs "Sales · 1–31 Jul".
 * `today` is the caller's local date (isoDateLocal), never the server's.
 *
 * Kept pure and tested because it is the only thing telling the operator WHICH
 * period a number on screen belongs to — getting it wrong misreports money.
 */
export function periodLabel(
  range: { from: string | null; to: string | null },
  today: string,
): string {
  const { from, to } = range;
  const year = today.slice(0, 4);
  if (!from && !to) return "All time";
  if (from && to) {
    if (from === to) return from === today ? "Today" : shortDate(from, year);
    return `${shortDate(from, year)} – ${shortDate(to, year)}`;
  }
  if (from) return `From ${shortDate(from, year)}`;
  return `Up to ${shortDate(to!, year)}`;
}

// ─── Reconciliation ─────────────────────────────────────────────────────────
// Mirrors of close_cash_day()'s arithmetic in SQL (migration 0049). The SQL copy
// is what a closed day is actually stored from; these exist so the page can show
// a live difference as the operator types.

/** The amount with its sign applied. `amount` itself is always positive. */
export function signedAmount(e: CashEntry): number {
  return e.direction === "in" ? e.amount : -e.amount;
}

export function accountBalance(entries: CashEntry[], account: CashAccount): number {
  return round2(
    entries
      .filter((e) => e.account === account)
      .reduce((sum, e) => sum + signedAmount(e), 0),
  );
}

/**
 * Opening cash plus the day's cash movements. Bank entries never apply — there
 * is no physical count to reconcile the bank against.
 */
export function expectedCash(openingCash: number, entries: CashEntry[]): number {
  return round2(openingCash + accountBalance(entries, "cash"));
}

/** Counted minus expected: negative is short, positive is excess. */
export function cashDifference(counted: number, expected: number): number {
  return round2(counted - expected);
}

export function differenceLabel(diff: number): {
  tone: "short" | "excess" | "exact";
  label: string;
} {
  if (diff < 0) return { tone: "short", label: "Short" };
  if (diff > 0) return { tone: "excess", label: "Excess" };
  return { tone: "exact", label: "Tallied" };
}
