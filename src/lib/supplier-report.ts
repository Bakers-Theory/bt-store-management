/**
 * The six supplier reports (FR-17→FR-19), as data.
 *
 * Each report is described once, as a spec that yields raw rows — numbers stay
 * numbers. `supplierReport` maps those through a currency formatter for the A4
 * print document; `supplierReportSheets` hands the same raw rows to Excel, where
 * a number must arrive as a number to be summed. That split is the arrangement
 * `advance.ts` (raw) and `report.ts` (formatted) already use.
 *
 * In-house handling is per-report and deliberate:
 *   Supplier-wise Purchases  separate section
 *   Product-wise Purchases   included, with a type column
 *   Outstanding Payments     excluded by construction
 *   Purchase History         included, with a type column
 *   GST Purchases            excluded by construction
 *   Payment History          excluded by construction
 */
import { rangeLabel, type PrintReport, type ReportTable, type ShopInfo } from "./report";
import { inRange, type DateRange, type Sheet } from "./excel";
import { round2 } from "./salary";
import type {
  PurchaseInvoice,
  PurchaseReturn,
  SupplierPayment,
  SupplierSummary,
} from "./types";

export type SupplierReportType =
  | "supplierPurchases"
  | "productPurchases"
  | "outstanding"
  | "purchaseHistory"
  | "gstPurchases"
  | "paymentHistory";

export const SUPPLIER_REPORT_TYPES: SupplierReportType[] = [
  "supplierPurchases",
  "productPurchases",
  "outstanding",
  "purchaseHistory",
  "gstPurchases",
  "paymentHistory",
];

export const SUPPLIER_REPORT_META: Record<
  SupplierReportType,
  { name: string; slug: string; /** True when the range does not apply. */ snapshot: boolean }
> = {
  supplierPurchases: { name: "Supplier-wise Purchases", slug: "Supplier_Purchases", snapshot: false },
  productPurchases:  { name: "Product-wise Purchases",  slug: "Product_Purchases",  snapshot: false },
  // A balance is a position as it stands now, not a sum over a window.
  outstanding:       { name: "Outstanding Payments",    slug: "Outstanding",        snapshot: true },
  purchaseHistory:   { name: "Purchase History",        slug: "Purchase_History",   snapshot: false },
  gstPurchases:      { name: "GST Purchases",           slug: "GST_Purchases",      snapshot: false },
  paymentHistory:    { name: "Payment History",         slug: "Payment_History",    snapshot: false },
};

export interface SupplierReportData {
  shop: ShopInfo;
  /** All statuses; the builders filter to `posted` themselves. */
  invoices: PurchaseInvoice[];
  payments: SupplierPayment[];
  returns: PurchaseReturn[];
  /** Live account positions, from `supplier_summary_v`. */
  summaries: SupplierSummary[];
}

export interface SupplierReportTable {
  heading?: string;
  header: string[];
  /** Column indices holding money — formatted for print, raw for Excel. */
  moneyCols: number[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  empty: string;
}

const slug = (s: string) => (s || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const posted = (invoices: PurchaseInvoice[], range: DateRange) =>
  invoices.filter((i) => i.status === "posted" && inRange(i.purchaseDate, range));

const isExternal = <T extends { supplierType: "external" | "in_house" }>(r: T) =>
  r.supplierType === "external";

const typeLabel = (t: "external" | "in_house") => (t === "in_house" ? "In-house" : "External");

/** ISO dates sort lexically, so newest-first needs no Date construction. */
const byDateDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

const sum = (ns: number[]) => round2(ns.reduce((s, n) => s + n, 0));

const pad = (row: (string | number)[], width: number): (string | number)[] => [
  ...row,
  ...Array(Math.max(0, width - row.length)).fill(""),
];

// ─── Table builders, one per report ─────────────────────────────────────────

function supplierPurchasesTables(
  data: SupplierReportData,
  range: DateRange,
): SupplierReportTable[] {
  const rows = posted(data.invoices, range);
  const group = (external: boolean) => {
    const mine = rows.filter((i) => isExternal(i) === external);
    const byId = new Map<string, PurchaseInvoice[]>();
    for (const i of mine) byId.set(i.supplierId, [...(byId.get(i.supplierId) ?? []), i]);
    return [...byId.values()]
      .map((list) => list.slice().sort((a, b) => byDateDesc(a.purchaseDate, b.purchaseDate)))
      .sort((a, b) => a[0].supplierName.localeCompare(b[0].supplierName));
  };

  const external = group(true);
  const tables: SupplierReportTable[] = [
    {
      heading: "External suppliers",
      header: ["Code", "Supplier", "Invoices", "Subtotal", "GST", "Total"],
      moneyCols: [3, 4, 5],
      rows: external.map((list) => [
        list[0].supplierCode,
        list[0].supplierName,
        list.length,
        sum(list.map((i) => i.subtotal)),
        sum(list.map((i) => i.gstAmount ?? 0)),
        sum(list.map((i) => i.total)),
      ]),
      totals: [
        "Total",
        "",
        external.reduce((s, l) => s + l.length, 0),
        sum(external.flatMap((l) => l.map((i) => i.subtotal))),
        sum(external.flatMap((l) => l.map((i) => i.gstAmount ?? 0))),
        sum(external.flatMap((l) => l.map((i) => i.total))),
      ],
      empty: "No purchases from external suppliers in this period.",
    },
  ];

  // A separate section, not a separate report: in-house cost is real but is
  // never a payable, so it must not land in the totals above.
  const inHouse = group(false);
  if (inHouse.length) {
    tables.push({
      heading: "In-house production",
      header: ["Code", "Source", "Receipts", "Value"],
      moneyCols: [3],
      rows: inHouse.map((list) => [
        list[0].supplierCode,
        list[0].supplierName,
        list.length,
        sum(list.map((i) => i.total)),
      ]),
      totals: [
        "Total",
        "",
        inHouse.reduce((s, l) => s + l.length, 0),
        sum(inHouse.flatMap((l) => l.map((i) => i.total))),
      ],
      empty: "No in-house production in this period.",
    });
  }

  return tables;
}

function productPurchasesTables(
  data: SupplierReportData,
  range: DateRange,
): SupplierReportTable[] {
  interface Agg { item: string; type: string; qty: number; cost: number; suppliers: Set<string> }
  const byKey = new Map<string, Agg>();

  for (const inv of posted(data.invoices, range)) {
    for (const l of inv.lines) {
      // Keyed by item AND type so one product bought in and made in-house
      // reports as two rows rather than one misleading blend.
      const key = `${l.itemId}|${inv.supplierType}`;
      const agg = byKey.get(key) ?? {
        item: l.itemName,
        type: typeLabel(inv.supplierType),
        qty: 0,
        cost: 0,
        suppliers: new Set<string>(),
      };
      agg.qty = round2(agg.qty + l.qty);
      agg.cost = round2(agg.cost + l.lineTotal);
      agg.suppliers.add(inv.supplierName);
      byKey.set(key, agg);
    }
  }

  const rows = [...byKey.values()]
    .sort((a, b) => b.cost - a.cost || a.item.localeCompare(b.item))
    .map((a) => [
      a.item,
      a.type,
      a.qty,
      a.cost,
      a.qty > 0 ? round2(a.cost / a.qty) : 0,
      [...a.suppliers].sort().join(", "),
    ]);

  return [
    {
      header: ["Product", "Type", "Qty", "Total cost", "Avg unit cost", "Sources"],
      moneyCols: [3, 4],
      rows,
      totals: ["Total", "", sum(rows.map((r) => Number(r[2]))), sum(rows.map((r) => Number(r[3]))), "", ""],
      empty: "Nothing was purchased in this period.",
    },
  ];
}

function outstandingTables(data: SupplierReportData): SupplierReportTable[] {
  // In-house is excluded by construction: there is no payable to be outstanding.
  const rows = data.summaries
    .filter(isExternal)
    .filter((s) => s.outstanding !== 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .map((s) => [
      s.supplierCode,
      s.supplierName,
      s.totalPurchases,
      s.totalPayments,
      s.returnCredit,
      s.outstanding,
      s.lastPaymentDate ?? "—",
    ]);

  return [
    {
      header: [
        "Code", "Supplier", "Purchases", "Payments", "Return credit",
        "Outstanding", "Last payment",
      ],
      moneyCols: [2, 3, 4, 5],
      rows,
      totals: [
        "Total", "",
        sum(rows.map((r) => Number(r[2]))),
        sum(rows.map((r) => Number(r[3]))),
        sum(rows.map((r) => Number(r[4]))),
        sum(rows.map((r) => Number(r[5]))),
        "",
      ],
      empty: "Nothing is outstanding to any supplier.",
    },
  ];
}

function purchaseHistoryTables(
  data: SupplierReportData,
  range: DateRange,
): SupplierReportTable[] {
  const rows = posted(data.invoices, range)
    .slice()
    .sort((a, b) => byDateDesc(a.purchaseDate, b.purchaseDate))
    .map((i) => [
      i.purchaseDate,
      // An in-house receipt has no supplier invoice number, so its own
      // reference stands in that column.
      i.invoiceNo ?? i.internalRef ?? "—",
      i.supplierName,
      typeLabel(i.supplierType),
      i.lines.length,
      i.subtotal,
      i.gstAmount ?? 0,
      i.total,
    ]);

  return [
    {
      header: ["Date", "Reference", "Supplier", "Type", "Lines", "Subtotal", "GST", "Total"],
      moneyCols: [5, 6, 7],
      rows,
      totals: [
        "Total", "", "", "",
        rows.reduce((s, r) => s + Number(r[4]), 0),
        sum(rows.map((r) => Number(r[5]))),
        sum(rows.map((r) => Number(r[6]))),
        sum(rows.map((r) => Number(r[7]))),
      ],
      empty: "No purchases in this period.",
    },
  ];
}

function gstPurchasesTables(
  data: SupplierReportData,
  range: DateRange,
): SupplierReportTable[] {
  // Excluded by construction twice over: in-house rows carry a null GST amount
  // AND are filtered on type, so neither route can leak one in.
  const rows = posted(data.invoices, range)
    .filter(isExternal)
    .filter((i) => (i.gstAmount ?? 0) > 0)
    .sort((a, b) => byDateDesc(a.purchaseDate, b.purchaseDate))
    .map((i) => [
      i.purchaseDate,
      i.invoiceNo ?? "—",
      i.supplierName,
      i.subtotal,
      i.gstAmount ?? 0,
      i.total,
    ]);

  return [
    {
      header: ["Date", "Invoice", "Supplier", "Taxable value", "GST", "Total"],
      moneyCols: [3, 4, 5],
      rows,
      totals: [
        "Total", "", "",
        sum(rows.map((r) => Number(r[3]))),
        sum(rows.map((r) => Number(r[4]))),
        sum(rows.map((r) => Number(r[5]))),
      ],
      empty: "No GST was charged on purchases in this period.",
    },
  ];
}

function paymentHistoryTables(
  data: SupplierReportData,
  range: DateRange,
): SupplierReportTable[] {
  // Excluded by construction: an in-house supplier cannot be paid, so no
  // payment row can reference one.
  const rows = data.payments
    .filter((p) => inRange(p.paidOn, range))
    .slice()
    .sort((a, b) => byDateDesc(a.paidOn, b.paidOn))
    .map((p) => [
      p.paidOn,
      p.supplierName,
      p.invoiceNo ?? "On account",
      p.mode,
      p.referenceNo || "—",
      p.amount,
    ]);

  return [
    {
      header: ["Date", "Supplier", "Invoice", "Mode", "Reference", "Amount"],
      moneyCols: [5],
      rows,
      totals: ["Total", "", "", "", "", sum(rows.map((r) => Number(r[5])))],
      empty: "No payments in this period.",
    },
  ];
}

/** The raw tables for one report. Money columns hold numbers, not strings. */
export function supplierReportTables(
  type: SupplierReportType,
  data: SupplierReportData,
  range: DateRange,
): SupplierReportTable[] {
  switch (type) {
    case "supplierPurchases": return supplierPurchasesTables(data, range);
    case "productPurchases":  return productPurchasesTables(data, range);
    case "outstanding":       return outstandingTables(data);
    case "purchaseHistory":   return purchaseHistoryTables(data, range);
    case "gstPurchases":      return gstPurchasesTables(data, range);
    case "paymentHistory":    return paymentHistoryTables(data, range);
  }
}

// ─── Print (A4) ─────────────────────────────────────────────────────────────

const NOTES: Record<SupplierReportType, string> = {
  supplierPurchases:
    "In-house production is reported in its own section and is never included in " +
    "the external totals — it carries cost but is not a payable.",
  productPurchases:
    "Average unit cost is total cost divided by total quantity over the period, " +
    "not the latest purchase price.",
  outstanding:
    "A position as it stands today, not a total over the period. In-house " +
    "suppliers are excluded — there is nothing to pay. A negative figure means a " +
    "supplier has been paid or credited more than has been invoiced.",
  purchaseHistory:
    "Only posted purchases appear. A draft has not happened yet and a cancelled " +
    "invoice has been withdrawn.",
  gstPurchases:
    "In-house production is excluded — there is no GST on your own output. " +
    "Invoices with no GST are omitted.",
  paymentHistory:
    "Payments to external suppliers only. A payment shown against \"On account\" " +
    "was not tied to a specific invoice.",
};

function summaryFor(
  type: SupplierReportType,
  tables: SupplierReportTable[],
  money: (n: number) => string,
): { label: string; value: string }[] {
  const t = tables[0];
  const last = (row?: (string | number)[]) => Number(row?.[row.length - 1] ?? 0);
  switch (type) {
    case "supplierPurchases":
      return [
        { label: "Suppliers", value: String(t.rows.length) },
        { label: "Purchases", value: money(last(t.totals)) },
        {
          label: "In-house value",
          value: money(tables[1] ? last(tables[1].totals) : 0),
        },
      ];
    case "productPurchases":
      return [
        { label: "Products", value: String(t.rows.length) },
        { label: "Total cost", value: money(Number(t.totals?.[3] ?? 0)) },
      ];
    case "outstanding":
      return [
        { label: "Suppliers owing", value: String(t.rows.length) },
        { label: "Purchases", value: money(Number(t.totals?.[2] ?? 0)) },
        { label: "Payments", value: money(Number(t.totals?.[3] ?? 0)) },
        { label: "Outstanding", value: money(Number(t.totals?.[5] ?? 0)) },
      ];
    case "purchaseHistory":
      return [
        { label: "Purchases", value: String(t.rows.length) },
        { label: "GST", value: money(Number(t.totals?.[6] ?? 0)) },
        { label: "Total", value: money(last(t.totals)) },
      ];
    case "gstPurchases":
      return [
        { label: "Invoices", value: String(t.rows.length) },
        { label: "Taxable value", value: money(Number(t.totals?.[3] ?? 0)) },
        { label: "GST", value: money(Number(t.totals?.[4] ?? 0)) },
      ];
    case "paymentHistory":
      return [
        { label: "Payments", value: String(t.rows.length) },
        { label: "Total paid", value: money(last(t.totals)) },
      ];
  }
}

export function supplierReport(
  type: SupplierReportType,
  data: SupplierReportData,
  range: DateRange,
): PrintReport {
  const meta = SUPPLIER_REPORT_META[type];
  const cur = data.shop.currency || "₹";
  const money = (n: number) => `${cur}${n.toFixed(2)}`;
  const raw = supplierReportTables(type, data, range);

  const format = (row: (string | number)[], moneyCols: number[]) =>
    row.map((v, i) => (moneyCols.includes(i) && typeof v === "number" ? money(v) : v));

  const tables: ReportTable[] = raw.map((t) => ({
    heading: t.heading,
    columns: t.header.map((label, i) => ({
      label,
      num: t.moneyCols.includes(i) || label === "Qty" || label === "Lines" ||
           label === "Invoices" || label === "Receipts",
    })),
    rows: t.rows.map((r) => format(r, t.moneyCols)),
    totals: t.totals ? pad(format(t.totals, t.moneyCols), t.header.length) : undefined,
    empty: t.empty,
  }));

  return {
    kind: "report" as const,
    shop: data.shop.name || "Bakery",
    shopMeta: [data.shop.address, data.shop.phone].filter(Boolean).join(" · "),
    title: meta.name,
    period: meta.snapshot ? "As of today" : rangeLabel(range.from, range.to),
    scope: "All suppliers",
    summary: summaryFor(type, raw, money),
    tables,
    note: NOTES[type],
    fileName: `${slug(data.shop.name)}-${slug(meta.name)}-${range.from || "all"}${
      range.to ? `-to-${range.to}` : ""
    }`,
  };
}

// ─── Excel ──────────────────────────────────────────────────────────────────

/**
 * One sheet per table, rows keyed by column header. Money stays numeric so the
 * spreadsheet can sum it — the whole point of exporting rather than printing.
 */
export function supplierReportSheets(
  type: SupplierReportType,
  data: SupplierReportData,
  range: DateRange,
): Sheet[] {
  const meta = SUPPLIER_REPORT_META[type];
  // Sheet names are truncated and deduplicated by lib/excel.ts, so a long
  // heading here is safe.
  return supplierReportTables(type, data, range).map((t) => ({
    name: t.heading ? `${meta.slug} ${t.heading}` : meta.slug,
    rows: t.rows.map(
      (row) =>
        Object.fromEntries(t.header.map((h, n) => [h, row[n] ?? ""])) as Record<
          string,
          string | number
        >,
    ),
  }));
}
