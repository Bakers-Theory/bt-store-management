import type { Bakery, Bill, BillLine, Customer, Item, Log } from "./types";
import { isActiveBill } from "./format";
import {
  categoryPL as categoryPLData,
  stockHealth as stockHealthData,
  recommendations as recommendationsData,
} from "./analytics";

export interface ReportData {
  bakery: Bakery;
  items: Item[];
  bills: Bill[];
  logs: Log[];
  customers: Customer[];
}

export interface ReportResult {
  ok: boolean;
  error?: string;
}

export type DateRange = { from: string | null; to: string | null };

export type ReportType =
  | "sales" | "bills" | "products" | "stock"
  | "stockLog" | "customers" | "analytics" | "expiry" | "full";

export interface Sheet {
  name: string;
  rows: Record<string, string | number>[];
}

export const REPORT_META: Record<ReportType, { name: string; slug: string; snapshot: boolean }> = {
  sales:     { name: "Sales",       slug: "Sales",       snapshot: false },
  bills:     { name: "Bills",       slug: "Bills",       snapshot: false },
  products:  { name: "Products",    slug: "Products",    snapshot: true },
  stock:     { name: "Stock",       slug: "Stock",       snapshot: true },
  stockLog:  { name: "Stock Log",   slug: "Stock_Log",   snapshot: false },
  customers: { name: "Customers",   slug: "Customers",   snapshot: true },
  analytics: { name: "Analytics",   slug: "Analytics",   snapshot: false },
  expiry:    { name: "Expiry & Wastage", slug: "Expiry_Wastage", snapshot: true },
  full:      { name: "Full Report", slug: "Full_Report", snapshot: false },
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** True if the date portion of `dateStr` falls within the inclusive range. */
export function inRange(dateStr: string, range: DateRange): boolean {
  const d = dateStr.slice(0, 10); // "YYYY-MM-DD" — ISO date strings sort lexically
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/** Local-time "DD-MM-YYYY". */
export function formatDMY(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** "YYYY-MM-DD" -> "DD-MM-YYYY" without constructing a Date (no TZ drift). */
export function ymdToDMY(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
}

/** Local-time "YYYY-MM-DD". */
export function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function rangeSuffix(range: DateRange, snapshot: boolean): string {
  if (range.from && range.to) return `${ymdToDMY(range.from)}_to_${ymdToDMY(range.to)}`;
  if (range.from) return `from_${ymdToDMY(range.from)}`;
  if (range.to) return `upto_${ymdToDMY(range.to)}`;
  return snapshot ? "snapshot" : "all";
}

export function reportFileName(bakery: Bakery, type: ReportType, range: DateRange, _now: Date): string {
  const safe = (bakery.name || "Bakery").replace(/[^a-z0-9]/gi, "_");
  const meta = REPORT_META[type];
  const suffix = rangeSuffix(range, meta.snapshot);
  return `${safe}_${meta.slug}_${suffix}.xlsx`;
}

function periodLine(range: DateRange, now: Date, isSnapshot: boolean): string {
  if (isSnapshot) return "Snapshot as of " + formatDMY(now);
  if (range.from && range.to) return `Period: ${ymdToDMY(range.from)} to ${ymdToDMY(range.to)}`;
  if (range.from) return `Period: ${ymdToDMY(range.from)} onwards`;
  if (range.to) return `Period: up to ${ymdToDMY(range.to)}`;
  return "All records";
}

/** Label rows written above each sheet's data table. */
export function headerRows(
  bakery: Bakery, reportName: string, range: DateRange, now: Date, isSnapshot: boolean,
): string[][] {
  return [
    [bakery.name || "Bakery"],
    [`${reportName} Report`],
    [periodLine(range, now, isSnapshot)],
    [`Generated: ${now.toLocaleString("en-IN")}`],
  ];
}

// cost price for a bill line — prefer price recorded at sale time, else current item
function costOf(items: Item[], bi: BillLine): number {
  return bi.costPrice != null
    ? bi.costPrice
    : items.find((i) => i.id === bi.itemId)?.costPrice || 0;
}

// ─── Event report builders (date-filtered) ───────────────────────────────────

export function buildBillsReport(data: ReportData, range: DateRange, _now: Date): Sheet[] {
  const { items, bills, bakery } = data;
  const cur = bakery.currency;
  const rows: Record<string, string | number>[] = bills
    .filter((b) => inRange(b.date, range))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    .map((b) => {
      const cogs = b.items.reduce((s, bi) => s + bi.qty * costOf(items, bi), 0);
      return {
        "Bill No": b.billNo,
        Status: b.status === "cancelled" ? "Cancelled" : "Active",
        Date: new Date(b.date).toLocaleDateString("en-IN"),
        Time: new Date(b.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        Customer: b.customerName || "Walk-in",
        Phone: b.customerPhone || "",
        Items: b.items.map((i) => `${i.name} x${i.qty}`).join(", "),
        [`Subtotal (${cur})`]: +b.subtotal.toFixed(2),
        [`Tax (${cur})`]: +b.tax.toFixed(2),
        [`Total (${cur})`]: +b.total.toFixed(2),
        [`Est. Profit (${cur})`]: b.status === "cancelled" ? 0 : +(b.subtotal - cogs).toFixed(2),
      };
    });
  if (rows.length === 0) rows.push({ "Bill No": "No bills in range" });
  return [{ name: "Bills", rows }];
}

export function buildSalesReport(data: ReportData, range: DateRange, _now: Date): Sheet[] {
  const { items, bills, bakery } = data;
  const cur = bakery.currency;
  const activeBills = bills.filter(isActiveBill).filter((b) => inRange(b.date, range));

  const monthly: Record<string, { revenue: number; bills: number; itemsSold: number; cogs: number }> = {};
  activeBills.forEach((b) => {
    const key = b.date.slice(0, 7); // "YYYY-MM" — matches inRange's date basis (no TZ drift)
    if (!monthly[key]) monthly[key] = { revenue: 0, bills: 0, itemsSold: 0, cogs: 0 };
    monthly[key].revenue += b.total;
    monthly[key].bills += 1;
    monthly[key].itemsSold += b.items.reduce((s, i) => s + i.qty, 0);
    monthly[key].cogs += b.items.reduce((s, bi) => s + bi.qty * costOf(items, bi), 0);
  });
  const months = Object.keys(monthly).sort();
  const rows: Record<string, string | number>[] = months.map((m, idx) => {
    const c = monthly[m];
    const prev = idx > 0 ? monthly[months[idx - 1]] : null;
    const growthPct = prev && prev.revenue > 0
      ? (((c.revenue - prev.revenue) / prev.revenue) * 100).toFixed(1) + "%" : "N/A";
    const profit = c.revenue - c.cogs;
    return {
      Month: m,
      [`Revenue (${cur})`]: +c.revenue.toFixed(2),
      "Bills Count": c.bills,
      "Items Sold": +c.itemsSold.toFixed(2),
      [`Avg Bill Value (${cur})`]: +(c.revenue / c.bills).toFixed(2),
      [`Est. Profit (${cur})`]: +profit.toFixed(2),
      "Profit Margin %": c.revenue ? ((profit / c.revenue) * 100).toFixed(1) + "%" : "N/A",
      "MoM Growth %": growthPct,
    };
  });
  if (rows.length === 0) rows.push({ Month: "No sales in range" });
  return [{ name: "Sales", rows }];
}

export function buildStockLogReport(data: ReportData, range: DateRange, _now: Date): Sheet[] {
  const { logs, bakery } = data;
  const cur = bakery.currency;
  const rows: Record<string, string | number>[] = logs
    .filter((l) => inRange(l.date, range))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    .map((l) => ({
      Date: new Date(l.date).toLocaleString("en-IN"),
      Type: l.type === "in" ? "Stock In" : l.type === "out" ? "Stock Out" : l.type === "bill" ? "Bill / Sale" : l.type,
      User: l.user ?? "",
      "Item / Bill": l.type === "bill" ? `Bill #${l.billNo}` : l.itemName ?? "",
      Qty: l.qty || "",
      Details: l.type === "bill"
        ? l.items ?? ""
        : (l.supplier ? `Supplier: ${l.supplier}` : l.reason || "") + (l.notes ? ` — ${l.notes}` : ""),
      [`Amount (${cur})`]: l.total || "",
    }));
  if (rows.length === 0) rows.push({ Date: "No activity in range" });
  return [{ name: "Stock Log", rows }];
}

// ─── Snapshot report builders (range-independent) ───────────────────────────

export function buildProductsReport(data: ReportData, _now: Date): Sheet[] {
  const { items, bakery } = data;
  const cur = bakery.currency;
  const rows: Record<string, string | number>[] = items.map((i) => {
    const cost = i.costPrice || 0;
    const marginPerUnit = i.price - cost;
    return {
      "Item Name": i.name,
      Category: i.category || "General",
      Unit: i.unit,
      [`Bought Price (${cur})`]: cost,
      [`Selling Price (${cur})`]: i.price,
      [`Profit / Unit (${cur})`]: +marginPerUnit.toFixed(2),
      "Margin %": cost ? ((marginPerUnit / i.price) * 100).toFixed(1) + "%" : i.price ? "100%" : "N/A",
      "Tracks Expiry": i.tracksExpiry ? "Yes" : "No",
      "Earliest Expiry": i.earliestExpiry ? ymdToDMY(i.earliestExpiry) : "—",
      Status: i.qty <= bakery.lowStockAlert ? "Low Stock" : "OK",
    };
  });
  if (rows.length === 0) rows.push({ "Item Name": "No products yet" });
  return [{ name: "Products", rows }];
}

export function buildStockReport(data: ReportData, now: Date): Sheet[] {
  const { items, bakery } = data;
  const cur = bakery.currency;
  const today = isoDateLocal(now);
  const rows: Record<string, string | number>[] = items.map((i) => {
    const cost = i.costPrice || 0;
    const expiredUnits = i.batches
      .filter((b) => b.expiryDate && b.expiryDate < today)
      .reduce((s, b) => s + b.qty, 0);
    const batchStr = i.batches
      .map((b) => `${b.qty} × ${b.expiryDate ? ymdToDMY(b.expiryDate) : "no expiry"}`)
      .join("; ");
    return {
      "Item Name": i.name,
      Category: i.category || "General",
      "Quantity in Stock": i.qty,
      [`Stock Value at Cost (${cur})`]: +(i.qty * cost).toFixed(2),
      [`Stock Value at Selling Price (${cur})`]: +(i.qty * i.price).toFixed(2),
      Status: i.qty <= bakery.lowStockAlert ? "Low Stock" : "OK",
      "Batch Count": i.batches.length,
      "Expired Units": expiredUnits,
      Batches: batchStr,
    };
  });
  if (rows.length === 0) rows.push({ "Item Name": "No products yet" });
  return [{ name: "Stock", rows }];
}

export function buildCustomersReport(data: ReportData, _now: Date): Sheet[] {
  const { customers, bakery } = data;
  const cur = bakery.currency;
  const rows: Record<string, string | number>[] = customers.map((c) => ({
    Phone: c.phone,
    Name: c.name || "—",
    "First Seen": new Date(c.firstSeen).toLocaleDateString("en-IN"),
    "Visit Count": c.visitCount,
    [`Total Spend (${cur})`]: +c.totalSpend.toFixed(2),
    "Last Purchase": c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString("en-IN") : "—",
  }));
  if (rows.length === 0) rows.push({ Phone: "No customers yet" });
  return [{ name: "Customers", rows }];
}

/**
 * At-risk perishables snapshot: units already expired or expiring within the
 * bakery's "expiring soon" window, and their value at cost. Only items with
 * some at-risk stock are listed.
 */
export function buildExpiryReport(data: ReportData, now: Date): Sheet[] {
  const { items, bakery } = data;
  const cur = bakery.currency;
  const today = isoDateLocal(now);
  const soonCutoff = isoDateLocal(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + bakery.expiringSoonDays),
  );

  const rows: Record<string, string | number>[] = [];
  for (const i of items) {
    const cost = i.costPrice || 0;
    let expiredUnits = 0;
    let soonUnits = 0;
    for (const b of i.batches) {
      if (!b.expiryDate) continue;
      if (b.expiryDate < today) expiredUnits += b.qty;
      else if (b.expiryDate <= soonCutoff) soonUnits += b.qty;
    }
    if (expiredUnits === 0 && soonUnits === 0) continue;
    const atRisk = i.batches
      .filter((b) => b.expiryDate && b.expiryDate <= soonCutoff)
      .map((b) => `${b.qty} × ${ymdToDMY(b.expiryDate as string)}`)
      .join("; ");
    rows.push({
      "Item Name": i.name,
      Category: i.category || "General",
      "Expired Units": expiredUnits,
      "Expiring Soon Units": soonUnits,
      [`Expired Value at Cost (${cur})`]: +(expiredUnits * cost).toFixed(2),
      [`Expiring Soon Value at Cost (${cur})`]: +(soonUnits * cost).toFixed(2),
      "Earliest Expiry": i.earliestExpiry ? ymdToDMY(i.earliestExpiry) : "—",
      "At-risk Batches": atRisk,
    });
  }
  rows.sort((a, b) => (b["Expired Units"] as number) - (a["Expired Units"] as number));
  if (rows.length === 0) rows.push({ "Item Name": "No expiring or expired stock" });
  return [{ name: "Expiry & Wastage", rows }];
}

// ─── Analytics report builder (date-filtered) ────────────────────────────────

export function buildAnalyticsReport(data: ReportData, range: DateRange, _now: Date): Sheet[] {
  const { items, bills, bakery } = data;
  const cur = bakery.currency;
  const rangedBills = bills.filter((b) => inRange(b.date, range));
  const activeBills = rangedBills.filter(isActiveBill);

  // Top Selling Items
  const itemSales: Record<string, { qty: number; revenue: number; cogs: number }> = {};
  activeBills.forEach((b) =>
    b.items.forEach((bi) => {
      if (!itemSales[bi.name]) itemSales[bi.name] = { qty: 0, revenue: 0, cogs: 0 };
      itemSales[bi.name].qty += bi.qty;
      itemSales[bi.name].revenue += bi.qty * bi.price;
      itemSales[bi.name].cogs += bi.qty * costOf(items, bi);
    }),
  );
  const topItems: Record<string, string | number>[] = Object.entries(itemSales)
    .map(([name, d]) => ({
      Item: name,
      "Units Sold": +d.qty.toFixed(2),
      [`Revenue (${cur})`]: +d.revenue.toFixed(2),
      [`Est. Profit (${cur})`]: +(d.revenue - d.cogs).toFixed(2),
    }))
    .sort((a, b) => (b[`Revenue (${cur})`] as number) - (a[`Revenue (${cur})`] as number));
  if (topItems.length === 0) topItems.push({ Item: "No sales in range", "Units Sold": 0 });

  // Category P&L
  const categoryPL: Record<string, string | number>[] = categoryPLData(rangedBills, items).map((c) => ({
    Category: c.category,
    [`Revenue (${cur})`]: +c.revenue.toFixed(2),
    [`COGS (${cur})`]: +c.cogs.toFixed(2),
    [`Gross Profit (${cur})`]: +c.profit.toFixed(2),
    "Margin %": c.marginPct !== null ? c.marginPct.toFixed(1) + "%" : "N/A",
    "Revenue Share %": c.sharePct !== null ? c.sharePct.toFixed(1) + "%" : "N/A",
  }));
  if (categoryPL.length === 0) categoryPL.push({ Category: "No sales in range" });

  // Stock Health
  const stockHealth: Record<string, string | number>[] = stockHealthData(rangedBills, items, bakery.lowStockAlert).map((s) => ({
    "Item Name": s.item.name,
    Category: s.item.category || "General",
    "Current Qty": s.item.qty,
    "Units Sold": +s.sold.toFixed(2),
    "Avg Sold / Day": +s.perDay.toFixed(2),
    "Days of Cover": s.daysCover !== null ? +s.daysCover.toFixed(1) : "∞",
    Verdict: s.verdict,
  }));
  if (stockHealth.length === 0) stockHealth.push({ "Item Name": "No items yet" });

  // Recommendations
  const recommendations: Record<string, string | number>[] = recommendationsData(rangedBills, items, bakery.lowStockAlert, cur).map((r) => ({
    Priority: r.priority,
    Insight: r.insight,
    Detail: r.detail,
  }));
  if (recommendations.length === 0) recommendations.push({ Priority: "", Insight: "Not enough data yet", Detail: "" });

  return [
    { name: "Top Selling Items", rows: topItems },
    { name: "Category P&L", rows: categoryPL },
    { name: "Stock Health", rows: stockHealth },
    { name: "Recommendations", rows: recommendations },
  ];
}


// ─── Summary + Full report ───────────────────────────────────────────────────

function buildSummary(data: ReportData, range: DateRange, now: Date): Sheet {
  const { items, bills, bakery } = data;
  const rangedBills = bills.filter((b) => inRange(b.date, range));
  const activeBills = rangedBills.filter(isActiveBill);
  const totalRevenue = activeBills.reduce((s, b) => s + b.total, 0);
  const totalCOGS = activeBills.reduce(
    (s, b) => s + b.items.reduce((si, bi) => si + bi.qty * costOf(items, bi), 0), 0);
  const totalProfit = totalRevenue - totalCOGS;
  const totalBills = activeBills.length;
  const cancelledCount = rangedBills.length - totalBills;
  const totalStockValue = items.reduce((s, i) => s + i.qty * i.price, 0);
  const totalStockCost = items.reduce((s, i) => s + i.qty * (i.costPrice || 0), 0);
  const lowStockCount = items.filter((i) => i.qty <= bakery.lowStockAlert).length;

  const rows: Record<string, string | number>[] = [
    { Metric: "Bakery Name", Value: bakery.name },
    { Metric: "Report Generated On", Value: now.toLocaleString("en-IN") },
    { Metric: "Total Revenue", Value: totalRevenue.toFixed(2) },
    { Metric: "Total Cost of Goods Sold", Value: totalCOGS.toFixed(2) },
    { Metric: "Total Gross Profit", Value: totalProfit.toFixed(2) },
    { Metric: "Gross Margin %", Value: totalRevenue ? ((totalProfit / totalRevenue) * 100).toFixed(1) + "%" : "N/A" },
    { Metric: "Total Bills (Active)", Value: totalBills },
    { Metric: "Cancelled Bills", Value: cancelledCount },
    { Metric: "Average Bill Value", Value: totalBills ? (totalRevenue / totalBills).toFixed(2) : 0 },
    { Metric: "Total Items in Inventory", Value: items.length },
    { Metric: "Current Stock Value (at Selling Price)", Value: totalStockValue.toFixed(2) },
    { Metric: "Current Stock Value (at Bought Price)", Value: totalStockCost.toFixed(2) },
    { Metric: "Low Stock Items", Value: lowStockCount },
  ];
  return { name: "Summary", rows };
}

export function buildFullReport(data: ReportData, range: DateRange, now: Date): Sheet[] {
  return [
    buildSummary(data, range, now),
    ...buildSalesReport(data, range, now),
    ...buildBillsReport(data, range, now),
    ...buildProductsReport(data, now),
    ...buildStockReport(data, now),
    ...buildExpiryReport(data, now),
    ...buildStockLogReport(data, range, now),
    ...buildCustomersReport(data, now),
    ...buildAnalyticsReport(data, range, now),
  ];
}

export function buildReport(
  type: ReportType, data: ReportData, range: DateRange, now: Date,
): { sheets: Sheet[]; reportName: string; isSnapshot: boolean } {
  const meta = REPORT_META[type];
  const sheets =
    type === "sales" ? buildSalesReport(data, range, now)
    : type === "bills" ? buildBillsReport(data, range, now)
    : type === "products" ? buildProductsReport(data, now)
    : type === "stock" ? buildStockReport(data, now)
    : type === "stockLog" ? buildStockLogReport(data, range, now)
    : type === "customers" ? buildCustomersReport(data, now)
    : type === "analytics" ? buildAnalyticsReport(data, range, now)
    : type === "expiry" ? buildExpiryReport(data, now)
    : buildFullReport(data, range, now);
  return { sheets, reportName: meta.name, isSnapshot: meta.snapshot };
}

// ─── Excel writer ─────────────────────────────────────────────────────────────

/** xlsx sheet names must be ≤31 chars and exclude : \ / ? * [ ] */
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
}

/** Ensure sheet names are unique within a workbook (xlsx rejects duplicates). */
function uniqueSheetName(name: string, used: Set<string>): string {
  let base = safeSheetName(name);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Build and download one Excel workbook containing every selected report's
 * sheets. Each sheet gets its own header block (period line reflects whether
 * that report is a snapshot). Loads `xlsx` on demand.
 */
export async function exportReports(
  types: ReportType[], data: ReportData, range: DateRange,
): Promise<ReportResult> {
  if (types.length === 0) return { ok: false, error: "Select at least one report" };
  if (data.items.length === 0 && data.bills.length === 0 && data.customers.length === 0) {
    return { ok: false, error: "No data yet to export" };
  }
  const now = new Date();
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const addSheet = (sheet: Sheet, reportName: string, isSnapshot: boolean) => {
    const header = headerRows(data.bakery, reportName, range, now, isSnapshot);
    const ws = XLSX.utils.aoa_to_sheet([...header, []]); // header block + blank spacer row
    if (sheet.rows.length) XLSX.utils.sheet_add_json(ws, sheet.rows, { origin: -1 });
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(sheet.name, used));
  };

  // Multi-report exports get a KPI cover sheet up front.
  if (types.length > 1) addSheet(buildSummary(data, range, now), "Summary", false);

  for (const type of types) {
    const { sheets, reportName, isSnapshot } = buildReport(type, data, range, now);
    for (const s of sheets) addSheet(s, reportName, isSnapshot);
  }
  // Single selection keeps its own report filename; a mix uses a generic one.
  const safe = (data.bakery.name || "Bakery").replace(/[^a-z0-9]/gi, "_");
  const fileName = types.length === 1
    ? reportFileName(data.bakery, types[0], range, now)
    : `${safe}_Reports_${rangeSuffix(range, false)}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return { ok: true };
}

/** Build and download an Excel file for a single report type. */
export async function exportReport(
  type: ReportType, data: ReportData, range: DateRange,
): Promise<ReportResult> {
  return exportReports([type], data, range);
}

/** Back-compat: the combined workbook used by Settings and Dashboard. */
export async function exportExcelReport(data: ReportData): Promise<ReportResult> {
  return exportReport("full", data, { from: null, to: null });
}
