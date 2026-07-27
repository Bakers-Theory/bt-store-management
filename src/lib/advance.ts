/**
 * Staff advance arithmetic.
 *
 * Mirrors the SQL in `0032_staff_advance.sql`: `advance_balance_of`,
 * `advance_cap_check`, and `set_advance_recovery`'s ceiling. SQL is the
 * authority — this exists so the UI can refuse an impossible figure without a
 * round trip, exactly as `computePay` mirrors `payroll_compute`. The tests
 * assert the two agree, including on the paise boundaries.
 */
import { round2 } from "./salary";
import type { AdvanceBalance, SalaryMode } from "./types";
import { SALARY_MODES } from "./salary";

/** An advance is handed over the same four ways a salary is. */
export const ADVANCE_MODES: SalaryMode[] = SALARY_MODES;

/**
 * What is still owed. Never negative: over-recovery is a data error, and
 * reporting it as a negative balance would read as the store owing the
 * employee.
 */
export const advanceBalance = (totalAdvanced: number, totalRecovered: number): number =>
  Math.max(0, round2(totalAdvanced - totalRecovered));

/**
 * How much more can be advanced. Pending requests count, so two requests that
 * each pass on their own cannot together breach the cap.
 */
export const advanceHeadroom = (
  balance: number,
  pending: number,
  monthlySalary: number,
): number => Math.max(0, round2(monthlySalary - balance - pending));

/** The cap check, with the message the UI shows. Mirrors `advance_cap_check`. */
export function canRequestAdvance(
  balance: number,
  pending: number,
  monthlySalary: number,
  amount: number,
): { ok: boolean; reason: string } {
  if (!(amount > 0)) {
    return { ok: false, reason: "An advance must be more than zero." };
  }
  // A zero or unset salary means a zero cap: nothing can be advanced.
  if (monthlySalary <= 0) {
    return { ok: false, reason: "Set a monthly salary on the Salaries tab first." };
  }
  const headroom = advanceHeadroom(balance, pending, monthlySalary);
  if (round2(amount) > headroom) {
    return {
      ok: false,
      reason: `Advances are capped at one month's salary — only ${headroom.toFixed(2)} left.`,
    };
  }
  return { ok: true, reason: "" };
}

/**
 * The most that can be recovered from one payroll period.
 *
 * `existingRecovery` is added back because the record's own recovery is already
 * subtracted inside the balance. Without it, lowering a recovery would be
 * impossible and raising one would be off by the old amount. Capped at `net`,
 * so net pay reaches zero but never goes negative.
 *
 * This doubles as the pre-filled default for the recovery input: the most that
 * can come off is also what we offer to take off. There is deliberately no
 * separate `suggestedRecovery` — it would be a byte-identical second copy.
 */
export const recoveryCeiling = (
  balance: number,
  existingRecovery: number,
  net: number,
): number => Math.max(0, Math.min(round2(balance + existingRecovery), round2(net)));

export const isRecoveryValid = (
  amount: number,
  balance: number,
  existingRecovery: number,
  net: number,
): boolean =>
  amount >= 0 && round2(amount) <= recoveryCeiling(balance, existingRecovery, net);

/** Employees who still owe something. */
export const openBalances = (rows: AdvanceBalance[]): AdvanceBalance[] =>
  rows.filter((r) => r.balance > 0);

export interface AdvanceTotals {
  /** Employees with an open balance — not the whole roster. */
  employees: number;
  advanced: number;
  recovered: number;
  outstanding: number;
  pending: number;
}

export function advanceTotals(rows: AdvanceBalance[]): AdvanceTotals {
  return {
    employees: openBalances(rows).length,
    advanced: round2(rows.reduce((s, r) => s + r.totalAdvanced, 0)),
    recovered: round2(rows.reduce((s, r) => s + r.totalRecovered, 0)),
    outstanding: round2(rows.reduce((s, r) => s + r.balance, 0)),
    pending: round2(rows.reduce((s, r) => s + r.pendingAmount, 0)),
  };
}

// ─── Report ─────────────────────────────────────────────────────────────────

export const ADVANCE_REPORT_HEADER = [
  "Employee", "Total advanced", "Total recovered", "Outstanding", "Oldest open",
];

/** Outstanding-balance snapshot rows. Employees who owe nothing are omitted. */
export function advanceReportRows(rows: AdvanceBalance[]): (string | number)[][] {
  return openBalances(rows)
    .slice()
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
    .map((r) => [
      r.employeeName,
      r.totalAdvanced,
      r.totalRecovered,
      r.balance,
      r.oldestOpen ?? "",
    ]);
}
