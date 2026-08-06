/**
 * GST arithmetic for customer invoices.
 *
 * Every function here is pure and is mirrored bit-for-bit by `generate_bill`
 * (migration 0069) — the same discipline `computeTotals` in `bill.ts` keeps.
 * The on-screen preview must match the stored invoice to the paisa, so the
 * rounding ORDER matters as much as the formulae. Do not "simplify" a round()
 * away without changing the SQL in the same commit.
 */

export type InvoiceType = "gst" | "non_gst";

export interface GstLine {
  name: string;
  hsn: string;
  gstRate: number;
  qty: number;
  price: number;
}

export interface GstLineResult {
  name: string;
  hsn: string;
  gstRate: number;
  qty: number;
  /** qty × price, before discount. */
  amount: number;
  /** This line's share of the invoice discount. */
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** cgst + sgst + igst. */
  tax: number;
  /** taxable + tax. */
  total: number;
}

export interface GstOptions {
  /** `store_settings.prices_include_gst`. */
  pricesIncludeGst: boolean;
  /** Place of supply differs from the store's state. */
  interstate: boolean;
  discountValue: number;
  discountMode: "percent" | "flat";
}

export interface GstTotals {
  lines: GstLineResult[];
  /** Sum of qty × price, before discount. Keeps `bills.subtotal`'s meaning. */
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
}

export interface HsnSummaryRow {
  hsn: string;
  gstRate: number;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** Format only — the check-digit algorithm is deliberately out of scope. */
export function isValidGstin(gstin: string): boolean {
  return GSTIN_RE.test(gstin);
}

/** The first two characters, or "" when the GSTIN is not well-formed. */
export function stateCodeFromGstin(gstin: string): string {
  return isValidGstin(gstin) ? gstin.slice(0, 2) : "";
}

/**
 * "2026-27" for any date between 1 April 2026 and 31 March 2027, read in the
 * store timezone. A bill rung up at 01:30 IST on 1 April belongs to the new
 * year even though it is still 31 March in UTC.
 */
export function financialYear(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Split a rupee discount across lines in proportion to their amounts. Each
 * share is rounded to the paisa and the residue is absorbed by the last
 * non-zero line, so the parts always sum to exactly `discountAmount` — a
 * pro-rata split that does not add up would leave the invoice total and the
 * line totals disagreeing.
 */
export function allocateDiscount(amounts: number[], discountAmount: number): number[] {
  const shares = amounts.map(() => 0);
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total <= 0 || discountAmount <= 0) return shares;

  const capped = Math.min(total, discountAmount);
  let lastNonZero = -1;
  let allocated = 0;
  for (let i = 0; i < amounts.length; i++) {
    if (amounts[i] <= 0) continue;
    lastNonZero = i;
    shares[i] = round2((capped * amounts[i]) / total);
    allocated = round2(allocated + shares[i]);
  }
  if (lastNonZero >= 0 && allocated !== capped) {
    shares[lastNonZero] = round2(shares[lastNonZero] + (capped - allocated));
  }
  return shares;
}

/**
 * Per-line and invoice-level GST.
 *
 * Inclusive: the taxable value is backed out of the price and the tax is the
 * REMAINDER, not a second rounded multiplication — that is what guarantees
 * `taxable + tax` equals the inclusive amount exactly.
 *
 * The discount comes off the taxable value BEFORE tax, per GST §15(3)(a).
 */
export function computeGstTotals(lines: GstLine[], opts: GstOptions): GstTotals {
  const amounts = lines.map((l) => round2(l.qty * l.price));
  const subtotal = round2(amounts.reduce((s, a) => s + a, 0));

  // Flat clamps the ₹-off to the subtotal; percent clamps the rate to 0–100.
  // Both are rounded to the paisa here, matching generate_bill's
  // `least(v_sub, greatest(0, round(…, 2)))` exactly.
  const rawDiscount =
    opts.discountMode === "flat"
      ? Math.min(subtotal, Math.max(0, round2(opts.discountValue)))
      : round2((subtotal * Math.min(100, Math.max(0, opts.discountValue))) / 100);
  const shares = allocateDiscount(amounts, rawDiscount);
  const discount = round2(shares.reduce((s, d) => s + d, 0));

  const results: GstLineResult[] = lines.map((l, i) => {
    const amount = amounts[i];
    const lineDiscount = shares[i];
    const net = round2(amount - lineDiscount);

    let taxable: number;
    let tax: number;
    if (opts.pricesIncludeGst) {
      taxable = round2(net / (1 + l.gstRate / 100));
      tax = round2(net - taxable);
    } else {
      taxable = net;
      tax = round2((taxable * l.gstRate) / 100);
    }

    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (opts.interstate) {
      igst = tax;
    } else {
      // The odd paisa goes to CGST so the two halves sum to the tax exactly.
      sgst = round2(Math.floor((tax * 100) / 2) / 100);
      cgst = round2(tax - sgst);
    }

    return {
      name: l.name,
      hsn: l.hsn,
      gstRate: l.gstRate,
      qty: l.qty,
      amount,
      discount: lineDiscount,
      taxable,
      cgst,
      sgst,
      igst,
      tax,
      total: round2(taxable + tax),
    };
  });

  const sum = (f: (r: GstLineResult) => number) => round2(results.reduce((s, r) => s + f(r), 0));

  return {
    lines: results,
    subtotal,
    discount,
    taxable: sum((r) => r.taxable),
    cgst: sum((r) => r.cgst),
    sgst: sum((r) => r.sgst),
    igst: sum((r) => r.igst),
    tax: sum((r) => r.tax),
    total: sum((r) => r.total),
  };
}

/** Grouped by HSN and rate — the tax summary block on the invoice. */
export function hsnSummary(lines: GstLineResult[]): HsnSummaryRow[] {
  const byKey = new Map<string, HsnSummaryRow>();
  for (const l of lines) {
    const key = `${l.hsn}|${l.gstRate}`;
    const row = byKey.get(key) ?? {
      hsn: l.hsn, gstRate: l.gstRate, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0,
    };
    row.qty = round2(row.qty + l.qty);
    row.taxable = round2(row.taxable + l.taxable);
    row.cgst = round2(row.cgst + l.cgst);
    row.sgst = round2(row.sgst + l.sgst);
    row.igst = round2(row.igst + l.igst);
    byKey.set(key, row);
  }
  return [...byKey.values()].sort(
    (a, b) => a.hsn.localeCompare(b.hsn) || a.gstRate - b.gstRate,
  );
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = h ? `${ONES[h]} Hundred` : "";
  const tail = rest ? twoDigits(rest) : "";
  return [head, tail].filter(Boolean).join(" ");
}

/** Indian lakh/crore wording, for the A4 invoice's "Amount in words" line. */
export function amountInWords(n: number): string {
  const rupees = Math.floor(round2(Math.abs(n)));
  const paise = Math.round(round2(Math.abs(n) * 100)) % 100;

  const groups: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  if (crore) groups.push(`${threeDigits(crore)} Crore`);
  if (lakh) groups.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) groups.push(`${threeDigits(thousand)} Thousand`);
  if (rest) groups.push(threeDigits(rest));

  const rupeeWords = groups.length ? groups.join(" ") : "Zero";
  const paiseWords = paise ? ` and ${twoDigits(paise)} Paise` : "";
  return `${rupeeWords} Rupees${paiseWords} Only`;
}
