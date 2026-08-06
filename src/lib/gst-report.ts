/**
 * The GST Summary workbook — the input a GSTR-1 return is typed from.
 *
 * Three sheets, matching how a return is actually filed: B2B invoice by
 * invoice, B2C consolidated by place of supply, and an HSN-wise roll-up.
 * Producing the GSTR-1 JSON itself is deliberately out of scope; these sheets
 * are where the numbers come from, not the filing.
 *
 * TWO EXCLUSIONS, both deliberate:
 *   - CANCELLED BILLS. A cancelled invoice keeps its number so the series stays
 *     gapless, but it is not a supply and must never be declared as one.
 *   - NON-GST BILLS. They carry no tax and no HSN; putting them here would
 *     inflate the taxable value of a return with sales that were never taxed.
 *
 * ABSORBED CONSUMABLES are excluded from the HSN sheet for the same reason they
 * are absent from the invoice: the customer paid nothing for them, so they are
 * not a supply. Charged ones are, and appear alongside item lines.
 */
import { inRange, type DateRange, type Sheet } from "./excel";
import { isActiveBill } from "./format";
import type { Bakery, Bill } from "./types";

/**
 * The slice of `ReportData` these sheets need. Declared narrowly rather than
 * importing `ReportData` so the module states its real dependencies — it reads
 * no items, logs or customers.
 */
export interface GstReportData {
  bakery: Bakery;
  bills: Bill[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Active, GST, in range — oldest first, the order a return is entered in. */
function gstBills(data: GstReportData, range: DateRange): Bill[] {
  return data.bills
    .filter(isActiveBill)
    .filter((b) => b.invoiceType === "gst")
    .filter((b) => inRange(b.date, range))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
}

export function gstSummarySheets(data: GstReportData, range: DateRange): Sheet[] {
  const cur = data.bakery.currency;
  const bills = gstBills(data, range);

  // ─── B2B: one row per invoice that carries a customer GSTIN ───────────────
  const b2bRows: Record<string, string | number>[] = bills
    .filter((b) => b.customerGstin !== "")
    .map((b) => ({
      "Invoice No": b.invoiceNo ?? "",
      Date: new Date(b.date).toLocaleDateString("en-IN"),
      Customer: b.customerName || "—",
      "Customer GSTIN": b.customerGstin,
      "Place of Supply": b.placeOfSupply,
      [`Taxable (${cur})`]: round2(b.taxableValue),
      [`CGST (${cur})`]: round2(b.cgst),
      [`SGST (${cur})`]: round2(b.sgst),
      [`IGST (${cur})`]: round2(b.igst),
      [`Total (${cur})`]: round2(b.total),
    }));
  if (b2bRows.length === 0) b2bRows.push({ "Invoice No": "No B2B invoices in range" });

  // ─── B2C: consolidated by place of supply ─────────────────────────────────
  // By place of supply ALONE, not by rate: a bill's stored split is
  // invoice-level, and a mixed-rate basket has no single rate to report it
  // against. Rate-level detail is the HSN sheet's job.
  const byPos = new Map<
    string,
    { invoices: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }
  >();
  for (const b of bills) {
    if (b.customerGstin !== "") continue;
    const key = b.placeOfSupply || "—";
    const acc = byPos.get(key) ?? {
      invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0,
    };
    acc.invoices += 1;
    acc.taxable = round2(acc.taxable + b.taxableValue);
    acc.cgst = round2(acc.cgst + b.cgst);
    acc.sgst = round2(acc.sgst + b.sgst);
    acc.igst = round2(acc.igst + b.igst);
    acc.total = round2(acc.total + b.total);
    byPos.set(key, acc);
  }
  const b2cRows: Record<string, string | number>[] = [...byPos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pos, a]) => ({
      "Place of Supply": pos,
      Invoices: a.invoices,
      [`Taxable (${cur})`]: a.taxable,
      [`CGST (${cur})`]: a.cgst,
      [`SGST (${cur})`]: a.sgst,
      [`IGST (${cur})`]: a.igst,
      [`Total (${cur})`]: a.total,
    }));
  if (b2cRows.length === 0) b2cRows.push({ "Place of Supply": "No B2C invoices in range" });

  // ─── HSN: every line of every GST invoice, grouped by HSN and rate ────────
  const byHsn = new Map<
    string,
    { hsn: string; rate: number; unit: string; qty: number;
      taxable: number; cgst: number; sgst: number; igst: number }
  >();
  const addLine = (
    hsn: string, rate: number, unit: string, qty: number,
    taxable: number, cgst: number, sgst: number, igst: number,
  ) => {
    const key = `${hsn}|${rate}`;
    const acc = byHsn.get(key) ?? {
      hsn, rate, unit, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0,
    };
    acc.qty = round2(acc.qty + qty);
    acc.taxable = round2(acc.taxable + taxable);
    acc.cgst = round2(acc.cgst + cgst);
    acc.sgst = round2(acc.sgst + sgst);
    acc.igst = round2(acc.igst + igst);
    byHsn.set(key, acc);
  };
  for (const b of bills) {
    for (const l of b.items) {
      addLine(l.hsn, l.gstRate, l.unit, l.qty, l.taxableValue, l.cgst, l.sgst, l.igst);
    }
    for (const c of b.consumables) {
      if (!c.charged) continue;
      addLine(c.hsn, c.gstRate, c.unit, c.qty, c.taxableValue, c.cgst, c.sgst, c.igst);
    }
  }
  const hsnRows: Record<string, string | number>[] = [...byHsn.values()]
    .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
    .map((r) => ({
      HSN: r.hsn || "—",
      "Rate %": r.rate,
      // UQC is the unit of measure the return asks for; the store's own unit is
      // the closest honest answer without a mapping table nobody maintains.
      UQC: r.unit,
      "Total Qty": r.qty,
      [`Taxable (${cur})`]: r.taxable,
      [`CGST (${cur})`]: r.cgst,
      [`SGST (${cur})`]: r.sgst,
      [`IGST (${cur})`]: r.igst,
    }));
  if (hsnRows.length === 0) hsnRows.push({ HSN: "No GST lines in range" });

  return [
    { name: "B2B", rows: b2bRows },
    { name: "B2C", rows: b2cRows },
    { name: "HSN Summary", rows: hsnRows },
  ];
}
