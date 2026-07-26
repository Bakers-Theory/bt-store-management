import type { PayrollRow, SalaryMode } from "./types";

/** The four ways a salary can be handed over, in picker order. */
export const SALARY_MODES: SalaryMode[] = ["Cash", "UPI", "Bank Transfer", "Cheque"];

export const isSalaryMode = (v: unknown): v is SalaryMode =>
  typeof v === "string" && (SALARY_MODES as string[]).includes(v);

/** Calendar days in a month — the payroll divisor. `month` is 1-12. */
export function calendarDays(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, which also gets
  // leap years right without a special case.
  return new Date(year, month, 0).getDate();
}

export interface Computed {
  perDay: number;
  deduction: number;
  net: number;
}

/**
 * The payroll arithmetic, mirroring `payroll_compute` in SQL.
 *
 * The rounding ORDER is the contract: the deduction is rounded to paise first,
 * then the net is derived from it, so `gross - deduction === net` holds exactly.
 * Rounding both independently would let a payslip fail to add up by a paisa.
 *
 * `unpaidDays` covers Leave (1) and Half Day (0.5) only — unrecorded days are
 * absent from it, so a gap in attendance never deducts.
 */
export function computePay(
  gross: number,
  days: number,
  unpaidDays: number,
): Computed {
  if (days <= 0) return { perDay: 0, deduction: 0, net: round2(gross) };
  const perDay = gross / days;
  // However much leave was taken, the deduction cannot exceed the salary.
  const deduction = Math.min(round2(gross), round2(perDay * Math.max(0, unpaidDays)));
  return { perDay, deduction, net: round2(gross - deduction) };
}

/** Round to paise, avoiding the float artefacts of a naive `toFixed`. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Days in the month with no attendance record — the completeness gap. */
export const missingDays = (row: PayrollRow): number =>
  Math.max(0, row.calendarDays - row.recorded);

/**
 * Rows with unmarked days in the period. These are NOT errors: an unmarked day
 * is excluded from the calculation by design, deducts nothing and is paid. The
 * only thing a gap can hide is leave that was never recorded, which is why this
 * surfaces as a note rather than a block.
 */
export const withGaps = (rows: PayrollRow[]): PayrollRow[] =>
  rows.filter((r) => r.gross > 0 && missingDays(r) > 0);

/**
 * True when someone deliberately changed the net away from what the calculation
 * produced *at the time it was prepared*. Compared against `storedComputedNet`,
 * not the live figure — otherwise an attendance edit would masquerade as a
 * manual adjustment.
 */
export const isAdjusted = (row: PayrollRow): boolean =>
  row.net !== null &&
  row.storedComputedNet !== null &&
  round2(row.net) !== round2(row.storedComputedNet);

/**
 * True when attendance has moved since the record was prepared, so the filed
 * figure no longer reflects the days behind it. Independent of `isAdjusted`:
 * a record can be both adjusted and stale.
 */
export const isStale = (row: PayrollRow): boolean =>
  row.storedComputedNet !== null &&
  round2(row.storedComputedNet) !== round2(row.computedNet);

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const periodLabel = (year: number, month: number): string =>
  `${MONTHS[month - 1] ?? month} ${year}`;

/** "2026-07" — for filenames and stable sorting. */
export const periodSlug = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}`;

export interface PayrollTotals {
  employees: number;
  gross: number;
  deduction: number;
  net: number;
  paid: number;
  unpaid: number;
  notCreated: number;
}

/**
 * Payroll totals for a month. Only employees with a salary set are counted —
 * someone with no salary isn't on the payroll and would otherwise show as an
 * unpaid ₹0 obligation.
 */
export function payrollTotals(rows: PayrollRow[]): PayrollTotals {
  const onPayroll = rows.filter((r) => r.gross > 0);
  return {
    employees: onPayroll.length,
    gross: round2(onPayroll.reduce((s, r) => s + r.gross, 0)),
    deduction: round2(onPayroll.reduce((s, r) => s + r.deduction, 0)),
    // The filed net where a record exists, otherwise what it would be.
    net: round2(onPayroll.reduce((s, r) => s + (r.net ?? r.computedNet), 0)),
    paid: onPayroll.filter((r) => r.status === "paid").length,
    unpaid: onPayroll.filter((r) => r.status === "unpaid").length,
    notCreated: onPayroll.filter((r) => r.status === "none").length,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

/** Monthly salary report rows, shared by the CSV and Excel exports. */
export function payrollReportRows(
  rows: PayrollRow[],
  year: number,
  month: number,
): (string | number)[][] {
  const period = periodSlug(year, month);
  return rows
    .filter((r) => r.gross > 0)
    .map((r) => [
      period,
      r.employeeName,
      r.gross,
      r.calendarDays,
      r.recorded,
      missingDays(r),
      r.unpaidDays,
      r.deduction,
      r.computedNet,
      r.net ?? "",
      r.status === "none" ? "not created" : r.status,
      r.paidOn ?? "",
      r.paymentMode,
    ]);
}

export const PAYROLL_REPORT_HEADER = [
  "Period", "Employee", "Gross", "Calendar days", "Days recorded",
  "Days missing", "Unpaid days", "Deduction", "Calculated net", "Net paid",
  "Status", "Paid on", "Mode",
];
