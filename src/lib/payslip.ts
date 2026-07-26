/**
 * A payslip: a per-employee document for one payroll period.
 *
 * Built only from figures already on the payroll/payment record — gross,
 * calendar days, days recorded, unpaid days, deduction, net. It deliberately
 * does NOT show a per-status attendance breakdown, because that would need
 * `attendance_summary`, which is gated on `attendance.view`; someone holding
 * only `salary.*` must still be able to issue a payslip.
 */
import { periodLabel, periodSlug, round2 } from "./salary";
import type { PayrollRow, SalaryPayment } from "./types";
import type { ShopInfo } from "./report";

export interface PayslipLine {
  label: string;
  value: string;
  /** Rendered as a deduction (negative, in red-free print: parenthesised). */
  minus?: boolean;
  strong?: boolean;
}

export interface Payslip {
  kind: "payslip";
  shop: string;
  shopMeta: string;
  title: string;
  period: string;
  employeeName: string;
  /** Salary / attendance inputs, shown as a labelled grid. */
  facts: { label: string; value: string }[];
  /** Earnings → deductions → net, in order. */
  lines: PayslipLine[];
  net: string;
  netInWords: string;
  statusLine: string;
  note: string;
  fileName: string;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99 in words. */
function under100(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** 0–999 in words. */
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!h) return under100(rest);
  return rest ? `${ONES[h]} Hundred ${under100(rest)}` : `${ONES[h]} Hundred`;
}

/**
 * Whole number in words using the Indian system (thousand, lakh, crore), which
 * is what a ₹ payslip is expected to read like — not the short scale.
 */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const whole = Math.floor(n);
  if (whole === 0) return "Zero";

  let rest = whole;
  const crore = Math.floor(rest / 10_000_000);
  rest %= 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${under1000(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}

/**
 * "Sixteen Thousand Five Hundred Forty Eight Rupees and Thirty Nine Paise Only"
 * — the conventional payslip phrasing. Paise are omitted when zero.
 */
export function amountInWords(amount: number): string {
  const n = round2(Math.max(0, amount));
  const rupees = Math.floor(n);
  // Derive paise from the rounded value to avoid 0.39 → 38 float artefacts.
  const paise = Math.round((n - rupees) * 100);
  const head = `${numberToWords(rupees)} Rupee${rupees === 1 ? "" : "s"}`;
  if (!paise) return `${head} Only`;
  return `${head} and ${under100(paise)} Paise Only`;
}

const slug = (s: string) => (s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "-");

function build(
  shop: ShopInfo,
  employeeName: string,
  year: number,
  month: number,
  gross: number,
  calendarDays: number,
  recorded: number | null,
  unpaidDays: number,
  deduction: number,
  net: number,
  computedNet: number,
  overrideReason: string,
  status: "paid" | "unpaid" | "none",
  paidOn: string | null,
  paymentMode: string,
): Payslip {
  const cur = shop.currency || "₹";
  const money = (v: number) => `${cur}${v.toFixed(2)}`;
  const perDay = calendarDays > 0 ? gross / calendarDays : 0;
  const adjusted = round2(net) !== round2(computedNet);

  const lines: PayslipLine[] = [
    { label: "Monthly salary", value: money(gross) },
  ];
  if (deduction > 0) {
    lines.push({
      label: `Unpaid days (${unpaidDays} × ${money(round2(perDay))})`,
      value: money(deduction),
      minus: true,
    });
  }
  if (adjusted) {
    lines.push({
      label: `Adjustment${overrideReason ? ` — ${overrideReason}` : ""}`,
      value: money(round2(net - computedNet)),
      minus: net < computedNet,
    });
  }
  lines.push({ label: "Net pay", value: money(net), strong: true });

  return {
    kind: "payslip",
    shop: shop.name || "Bakery",
    shopMeta: [shop.address, shop.phone].filter(Boolean).join(" · "),
    title: "Payslip",
    period: periodLabel(year, month),
    employeeName,
    facts: [
      { label: "Days in month", value: String(calendarDays) },
      // Omitted rather than guessed when the record predates the snapshot.
      ...(recorded === null
        ? []
        : [{ label: "Days recorded", value: String(recorded) }]),
      { label: "Unpaid days", value: String(unpaidDays) },
      { label: "Per-day rate", value: money(round2(perDay)) },
    ],
    lines,
    net: money(net),
    netInWords: amountInWords(net),
    statusLine:
      status === "paid" && paidOn
        ? `Paid on ${paidOn}${paymentMode ? ` by ${paymentMode}` : ""}`
        : status === "unpaid"
          ? "Payment pending"
          : "Payroll not yet prepared",
    note:
      "Leave is unpaid and a half day pays half. Days with no attendance record " +
      "are excluded from the calculation and paid in full.",
    fileName: `${slug(shop.name)}-payslip-${slug(employeeName)}-${periodSlug(year, month)}`,
  };
}

/** Payslip from the live payroll screen. */
export const payslipFromPayroll = (
  shop: ShopInfo,
  row: PayrollRow,
  year: number,
  month: number,
): Payslip =>
  build(
    shop, row.employeeName, year, month,
    row.gross, row.calendarDays, row.recorded, row.unpaidDays,
    // A prepared record's own figures win; otherwise show the live calculation.
    row.paymentId ? row.gross - (row.net ?? row.computedNet) : row.deduction,
    row.net ?? row.computedNet,
    row.storedComputedNet ?? row.computedNet,
    row.overrideReason,
    row.status, row.paidOn, row.paymentMode,
  );

/** Payslip from a filed payment record (reprinting an old month). */
export const payslipFromPayment = (shop: ShopInfo, p: SalaryPayment): Payslip =>
  build(
    shop, p.employeeName, p.periodYear, p.periodMonth,
    p.gross, p.calendarDays, p.recordedDays, p.unpaidDays,
    p.deduction, p.net, p.computedNet, p.overrideReason,
    p.status, p.paidOn, p.paymentMode,
  );
