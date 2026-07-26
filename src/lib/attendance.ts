import type { Attendance, AttendanceStatus, AttendanceSummary } from "./types";

/** Fixed order for status pickers, tallies and report columns. */
export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "present",
  "half_day",
  "leave",
  "holiday",
];

export interface StatusMeta {
  label: string;
  short: string;
  /** Fraction of a day this status pays. Phase 2 multiplies by the day rate. */
  weight: number;
}

export const STATUS_META: Record<AttendanceStatus, StatusMeta> = {
  present:  { label: "Present",  short: "P", weight: 1 },
  half_day: { label: "Half Day", short: "½", weight: 0.5 },
  leave:    { label: "Leave",    short: "L", weight: 1 },
  holiday:  { label: "Holiday",  short: "H", weight: 1 },
};

export const statusLabel = (s: AttendanceStatus): string => STATUS_META[s].label;

/** True if `value` is one of the recordable statuses (validates untrusted input). */
export const isAttendanceStatus = (value: unknown): value is AttendanceStatus =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(STATUS_META, value);

/**
 * Days an employee is paid for, given their status tallies.
 *
 * Deliberately mirrors `attendance_summary`'s `payable_days` in SQL: Present,
 * Holiday and Leave count whole, Half Day counts a half. A day with no record
 * contributes nothing — that is how an absence is expressed, so absences never
 * appear in `counts` at all. Kept as a pure function so payroll and the UI can
 * agree without a round-trip — the SQL copy stays the one payroll bills against.
 */
export function payableDays(counts: Record<AttendanceStatus, number>): number {
  const total = ATTENDANCE_STATUSES.reduce(
    (sum, s) => sum + counts[s] * STATUS_META[s].weight,
    0,
  );
  // Only half-days introduce fractions, so a single decimal place is exact.
  return Math.round(total * 10) / 10;
}

/** Tally a list of records by status. */
export function tally(
  records: Attendance[],
): Record<AttendanceStatus, number> {
  const counts = Object.fromEntries(
    ATTENDANCE_STATUSES.map((s) => [s, 0]),
  ) as Record<AttendanceStatus, number>;
  for (const r of records) counts[r.status] += 1;
  return counts;
}

/** Totals across every employee in a summary, for the history header. */
export function totalsOf(rows: AttendanceSummary[]) {
  return rows.reduce(
    (acc, r) => ({
      present: acc.present + r.present,
      halfDay: acc.halfDay + r.halfDay,
      leave: acc.leave + r.leave,
      holiday: acc.holiday + r.holiday,
      recorded: acc.recorded + r.recorded,
      payableDays: Math.round((acc.payableDays + r.payableDays) * 10) / 10,
    }),
    { present: 0, halfDay: 0, leave: 0, holiday: 0, recorded: 0, payableDays: 0 },
  );
}

/**
 * How many employees have no record for the selected day. With no "absent"
 * status this is also the absentee count, so it drives both the "N not marked"
 * hint and the bulk-fill action.
 */
export function unmarkedCount(employeeIds: string[], dayRecords: Attendance[]): number {
  const marked = new Set(dayRecords.map((r) => r.profileId));
  return employeeIds.filter((id) => !marked.has(id)).length;
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/**
 * RFC-4180 escaping: quote any field containing a comma, quote or newline, and
 * double up embedded quotes. A `\r\n` line ending keeps Excel happy.
 */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: (string | number)[][]): string =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

/** Detail export: one row per attendance record. */
export function attendanceCsv(records: Attendance[]): string {
  return toCsv([
    ["Date", "Employee", "Status", "Note", "Marked by"],
    ...records.map((r) => [
      r.date,
      r.employeeName,
      statusLabel(r.status),
      r.note,
      r.markedByName,
    ]),
  ]);
}

/** Summary export: one row per employee. */
export function summaryCsv(rows: AttendanceSummary[]): string {
  return toCsv([
    ["Employee", "Present", "Half Day", "Leave", "Holiday", "Days recorded", "Payable days"],
    ...rows.map((r) => [
      r.employeeName,
      r.present,
      r.halfDay,
      r.leave,
      r.holiday,
      r.recorded,
      r.payableDays,
    ]),
  ]);
}
