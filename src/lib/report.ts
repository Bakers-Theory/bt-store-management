/**
 * A printable report, described as data so the document that renders it is a
 * purpose-built A4 layout rather than a printout of the screen.
 *
 * Builders here are pure, so the exact contents of a PDF are unit-testable
 * without a browser.
 */
import { STATUS_META, ATTENDANCE_STATUSES, totalsOf } from "./attendance";
import { MONTHS, periodLabel, periodSlug, round2 } from "./salary";
import type {
  Attendance,
  AttendanceSummary,
  AdvanceBalance,
  PayrollRow,
  SalaryPayment,
} from "./types";
import { advanceReportRows, advanceTotals } from "./advance";

export interface ReportColumn {
  label: string;
  /** Right-aligned, tabular figures. */
  num?: boolean;
}

export interface ReportTable {
  heading?: string;
  columns: ReportColumn[];
  rows: (string | number)[][];
  /** Optional bold totals row; must match the column count. */
  totals?: (string | number)[];
  /** Shown in place of the table when there are no rows. */
  empty?: string;
}

export interface PrintReport {
  kind: "report";
  /** Shop name, from settings. */
  shop: string;
  shopMeta: string;
  title: string;
  period: string;
  scope: string;
  summary: { label: string; value: string }[];
  tables: ReportTable[];
  note: string;
  /** Suggested PDF filename, no extension — becomes `document.title`. */
  fileName: string;
}

const slug = (s: string) => (s || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** "1 Jul 2026 – 31 Jul 2026", or "All time" when unbounded. */
export function rangeLabel(from: string | null, to: string | null): string {
  const d = (iso: string) => {
    const [y, m, day] = iso.split("-");
    return `${Number(day)} ${MONTHS[Number(m) - 1]?.slice(0, 3) ?? m} ${y}`;
  };
  if (from && to) return from === to ? d(from) : `${d(from)} – ${d(to)}`;
  if (from) return `From ${d(from)}`;
  if (to) return `Up to ${d(to)}`;
  return "All time";
}

export interface ShopInfo {
  name: string;
  address: string;
  phone: string;
  currency: string;
}

const shopMetaOf = (shop: ShopInfo) =>
  [shop.address, shop.phone].filter(Boolean).join(" · ");

// ─── Attendance ─────────────────────────────────────────────────────────────

export function attendanceReport(
  shop: ShopInfo,
  summary: AttendanceSummary[],
  records: Attendance[],
  from: string | null,
  to: string | null,
  employeeName: string | null,
): PrintReport {
  const t = totalsOf(summary);
  const period = rangeLabel(from, to);

  return {
    kind: "report" as const,
    shop: shop.name || "Bakery",
    shopMeta: shopMetaOf(shop),
    title: "Attendance report",
    period,
    scope: employeeName ?? "All employees",
    summary: [
      { label: "Present", value: String(t.present) },
      { label: "Half day", value: String(t.halfDay) },
      { label: "Leave", value: String(t.leave) },
      { label: "Holiday", value: String(t.holiday) },
      { label: "Days recorded", value: String(t.recorded) },
      { label: "Unpaid days", value: String(t.unpaidDays) },
    ],
    tables: [
      {
        heading: "Per employee",
        columns: [
          { label: "Employee" },
          ...ATTENDANCE_STATUSES.map((s) => ({
            label: STATUS_META[s].label,
            num: true,
          })),
          { label: "Recorded", num: true },
          { label: "Unpaid", num: true },
        ],
        rows: summary.map((r) => [
          r.employeeName,
          r.present,
          r.halfDay,
          r.leave,
          r.holiday,
          r.recorded,
          r.unpaidDays,
        ]),
        totals: [
          "Total",
          t.present,
          t.halfDay,
          t.leave,
          t.holiday,
          t.recorded,
          t.unpaidDays,
        ],
        empty: "No attendance recorded for this period.",
      },
      {
        heading: "Detail",
        columns: [
          { label: "Date" },
          { label: "Employee" },
          { label: "Status" },
          { label: "Note" },
          { label: "Marked by" },
        ],
        rows: records.map((r) => [
          r.date,
          r.employeeName,
          STATUS_META[r.status].label,
          r.note,
          r.markedByName,
        ]),
        empty: "No individual records for this period.",
      },
    ],
    note:
      "Leave is unpaid and Half Day pays half. Days with no record are excluded " +
      "from the salary calculation and are paid in full.",
    fileName: `${slug(shop.name)}-attendance-${from || "all"}${to ? `-to-${to}` : ""}`,
  };
}

// ─── Payroll for one month ──────────────────────────────────────────────────

export function payrollReport(
  shop: ShopInfo,
  rows: PayrollRow[],
  year: number,
  month: number,
): PrintReport {
  const cur = shop.currency || "₹";
  const money = (n: number) => `${cur}${n.toFixed(2)}`;
  const onPayroll = rows.filter((r) => r.gross > 0);

  const gross = round2(onPayroll.reduce((s, r) => s + r.gross, 0));
  const deduction = round2(onPayroll.reduce((s, r) => s + r.deduction, 0));
  const net = round2(onPayroll.reduce((s, r) => s + (r.net ?? r.computedNet), 0));
  const paid = onPayroll.filter((r) => r.status === "paid").length;

  return {
    kind: "report" as const,
    shop: shop.name || "Bakery",
    shopMeta: shopMetaOf(shop),
    title: "Salary report",
    period: periodLabel(year, month),
    scope: `${onPayroll.length} employee${onPayroll.length === 1 ? "" : "s"} on payroll`,
    summary: [
      { label: "Gross", value: money(gross) },
      { label: "Deductions", value: money(deduction) },
      { label: "Net payable", value: money(net) },
      { label: "Paid", value: `${paid} of ${onPayroll.length}` },
    ],
    tables: [
      {
        columns: [
          { label: "Employee" },
          { label: "Gross", num: true },
          { label: "Days", num: true },
          { label: "Unpaid", num: true },
          { label: "Deduction", num: true },
          { label: "Net", num: true },
          { label: "Status" },
          { label: "Paid on" },
          { label: "Mode" },
        ],
        rows: onPayroll.map((r) => [
          r.employeeName,
          money(r.gross),
          `${r.recorded}/${r.calendarDays}`,
          r.unpaidDays,
          r.deduction > 0 ? `−${money(r.deduction)}` : money(0),
          money(r.net ?? r.computedNet),
          r.status === "none" ? "Not prepared" : r.status === "paid" ? "Paid" : "Unpaid",
          r.paidOn ?? "—",
          r.paymentMode || "—",
        ]),
        totals: ["Total", money(gross), "", "", `−${money(deduction)}`, money(net), "", "", ""],
        empty: "Nobody has a salary set for this period.",
      },
    ],
    note:
      `Per-day rate is the monthly salary divided by the ${
        onPayroll[0]?.calendarDays ?? "calendar"
      } days in this month. ` +
      "Deductions cover recorded leave and half days only; unmarked days are paid.",
    fileName: `${slug(shop.name)}-salary-${periodSlug(year, month)}`,
  };
}

// ─── Salary payment history ─────────────────────────────────────────────────

export function salaryHistoryReport(
  shop: ShopInfo,
  payments: SalaryPayment[],
  employeeName: string | null,
): PrintReport {
  const cur = shop.currency || "₹";
  const money = (n: number) => `${cur}${n.toFixed(2)}`;
  const paidRows = payments.filter((p) => p.status === "paid");
  const paidTotal = round2(paidRows.reduce((s, p) => s + p.net, 0));
  const unpaidTotal = round2(
    payments.filter((p) => p.status === "unpaid").reduce((s, p) => s + p.net, 0),
  );

  return {
    kind: "report" as const,
    shop: shop.name || "Bakery",
    shopMeta: shopMetaOf(shop),
    title: "Salary payment history",
    period: payments.length
      ? `${periodLabel(
          payments[payments.length - 1].periodYear,
          payments[payments.length - 1].periodMonth,
        )} – ${periodLabel(payments[0].periodYear, payments[0].periodMonth)}`
      : "No records",
    scope: employeeName ?? "All employees",
    summary: [
      { label: "Records", value: String(payments.length) },
      { label: "Paid", value: money(paidTotal) },
      { label: "Outstanding", value: money(unpaidTotal) },
    ],
    tables: [
      {
        columns: [
          { label: "Period" },
          { label: "Employee" },
          { label: "Gross", num: true },
          { label: "Deduction", num: true },
          { label: "Net", num: true },
          { label: "Status" },
          { label: "Paid on" },
          { label: "Mode" },
        ],
        rows: payments.map((p) => [
          periodSlug(p.periodYear, p.periodMonth),
          p.employeeName,
          money(p.gross),
          p.deduction > 0 ? `−${money(p.deduction)}` : money(0),
          money(p.net),
          p.status === "paid" ? "Paid" : "Unpaid",
          p.paidOn ?? "—",
          p.paymentMode || "—",
        ]),
        totals: ["Total paid", "", "", "", money(paidTotal), "", "", ""],
        empty: "No payroll records yet.",
      },
    ],
    note: "Adjusted figures keep the original calculation on record; see the app for the reason given.",
    fileName: `${slug(shop.name)}-salary-history${employeeName ? `-${slug(employeeName)}` : ""}`,
  };
}

/** A totals row may be shorter than the table; pad it so cells stay aligned. */
export const padTotals = (
  totals: (string | number)[],
  width: number,
): (string | number)[] => [...totals, ...Array(Math.max(0, width - totals.length)).fill("")];

// ─── Advances ───────────────────────────────────────────────────────────────

/**
 * Outstanding advance balances, as they stand right now. A snapshot, not a
 * ledger: employees who owe nothing are omitted, because a report of zeroes is
 * a report of nothing.
 *
 * "Outstanding" is net of every recovery already prepared, including on unpaid
 * payroll records — so this figure and the Payroll tab always agree.
 */
export function advanceReport(
  shop: ShopInfo,
  balances: AdvanceBalance[],
): PrintReport {
  const cur = shop.currency || "₹";
  const money = (v: number) => `${cur}${v.toFixed(2)}`;
  const totals = advanceTotals(balances);
  const rows = advanceReportRows(balances).map(([name, advanced, recovered, balance, oldest]) => [
    name,
    money(Number(advanced)),
    money(Number(recovered)),
    money(Number(balance)),
    oldest || "—",
  ]);

  return {
    kind: "report" as const,
    shop: shop.name || "Bakery",
    shopMeta: shopMetaOf(shop),
    title: "Staff advances outstanding",
    period: "As of today",
    scope: "Employees with an advance still to recover",
    summary: [
      { label: "Employees owing", value: String(totals.employees) },
      { label: "Total advanced", value: money(totals.advanced) },
      { label: "Total recovered", value: money(totals.recovered) },
      { label: "Outstanding", value: money(totals.outstanding) },
    ],
    tables: [
      {
        columns: [
          { label: "Employee" },
          { label: "Total advanced", num: true },
          { label: "Total recovered", num: true },
          { label: "Outstanding", num: true },
          { label: "Oldest open" },
        ],
        rows,
        totals: [
          "Total",
          money(totals.advanced),
          money(totals.recovered),
          money(totals.outstanding),
          "",
        ],
        empty: "Nobody has an advance outstanding.",
      },
    ],
    note:
      "Outstanding is net of every recovery already entered on a payroll " +
      "record, whether or not that salary has been paid.",
    fileName: `${slug(shop.name)}-advances-outstanding`,
  };
}