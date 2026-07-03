import type { Bakery, Bill, BillLine, Item, Log } from "./types";
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
}

export interface ReportResult {
  ok: boolean;
  error?: string;
}

/**
 * Assemble the 6-sheet workbook data. Pure (no xlsx dependency) so it can be
 * unit-tested. `now` is injectable for deterministic tests.
 */
export function buildReportSheets(data: ReportData, now: Date) {
  const { bakery, items, bills, logs } = data;
  const cur = bakery.currency;

  // cost price for a bill line — prefer price recorded at sale time, else current item
  const costOf = (bi: BillLine) =>
    bi.costPrice != null
      ? bi.costPrice
      : items.find((i) => i.id === bi.itemId)?.costPrice || 0;

  const activeBills = bills.filter(isActiveBill);

  // ── 1. Summary ──
  const totalRevenue = activeBills.reduce((s, b) => s + b.total, 0);
  const totalCOGS = activeBills.reduce(
    (s, b) => s + b.items.reduce((si, bi) => si + bi.qty * costOf(bi), 0),
    0,
  );
  const totalProfit = totalRevenue - totalCOGS;
  const totalBills = activeBills.length;
  const cancelledCount = bills.length - activeBills.length;
  const totalStockValue = items.reduce((s, i) => s + i.qty * i.price, 0);
  const totalStockCost = items.reduce((s, i) => s + i.qty * (i.costPrice || 0), 0);
  const lowStockCount = items.filter((i) => i.qty <= bakery.lowStockAlert).length;
  const firstBillDate = activeBills.length
    ? new Date(Math.min(...activeBills.map((b) => +new Date(b.date))))
    : null;
  const lastBillDate = activeBills.length
    ? new Date(Math.max(...activeBills.map((b) => +new Date(b.date))))
    : null;

  const summary = [
    { Metric: "Bakery Name", Value: bakery.name },
    { Metric: "Report Generated On", Value: now.toLocaleString("en-IN") },
    {
      Metric: "Reporting Period",
      Value: firstBillDate
        ? `${firstBillDate.toLocaleDateString("en-IN")} to ${lastBillDate!.toLocaleDateString("en-IN")}`
        : "No sales yet",
    },
    { Metric: "Total Revenue (All Time)", Value: totalRevenue.toFixed(2) },
    { Metric: "Total Cost of Goods Sold", Value: totalCOGS.toFixed(2) },
    { Metric: "Total Gross Profit", Value: totalProfit.toFixed(2) },
    { Metric: "Gross Margin %", Value: totalRevenue ? ((totalProfit / totalRevenue) * 100).toFixed(1) + "%" : "N/A" },
    { Metric: "Total Bills Generated (Active)", Value: totalBills },
    { Metric: "Cancelled Bills", Value: cancelledCount },
    { Metric: "Average Bill Value", Value: totalBills ? (totalRevenue / totalBills).toFixed(2) : 0 },
    { Metric: "Total Items in Inventory", Value: items.length },
    { Metric: "Current Stock Value (at Selling Price)", Value: totalStockValue.toFixed(2) },
    { Metric: "Current Stock Value (at Bought Price)", Value: totalStockCost.toFixed(2) },
    { Metric: "Low Stock Items", Value: lowStockCount },
  ];

  // ── 2. Inventory ──
  const inventory = items.map((i) => {
    const cost = i.costPrice || 0;
    const marginPerUnit = i.price - cost;
    return {
      "Item Name": i.name,
      Category: i.category || "General",
      Unit: i.unit,
      "Quantity in Stock": i.qty,
      [`Bought Price (${cur})`]: cost,
      [`Selling Price (${cur})`]: i.price,
      [`Profit / Unit (${cur})`]: +marginPerUnit.toFixed(2),
      "Margin %": cost ? ((marginPerUnit / i.price) * 100).toFixed(1) + "%" : i.price ? "100%" : "N/A",
      [`Stock Value at Cost (${cur})`]: +(i.qty * cost).toFixed(2),
      [`Stock Value at Selling Price (${cur})`]: +(i.qty * i.price).toFixed(2),
      Status: i.qty <= bakery.lowStockAlert ? "Low Stock" : "OK",
    };
  });

  // ── 3. Sales Report (all bills, incl. cancelled — see Status column) ──
  const sales = [...bills]
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    .map((b) => {
      const cogs = b.items.reduce((s, bi) => s + bi.qty * costOf(bi), 0);
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

  // ── 4. Business Growth Analysis (month over month, active bills only) ──
  const monthly: Record<string, { revenue: number; bills: number; itemsSold: number; cogs: number }> = {};
  activeBills.forEach((b) => {
    const d = new Date(b.date);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    if (!monthly[key]) monthly[key] = { revenue: 0, bills: 0, itemsSold: 0, cogs: 0 };
    monthly[key].revenue += b.total;
    monthly[key].bills += 1;
    monthly[key].itemsSold += b.items.reduce((s, i) => s + i.qty, 0);
    monthly[key].cogs += b.items.reduce((s, bi) => s + bi.qty * costOf(bi), 0);
  });
  const months = Object.keys(monthly).sort();
  const growth: Record<string, string | number>[] = months.map((m, idx) => {
    const c = monthly[m];
    const prev = idx > 0 ? monthly[months[idx - 1]] : null;
    const growthPct =
      prev && prev.revenue > 0
        ? (((c.revenue - prev.revenue) / prev.revenue) * 100).toFixed(1) + "%"
        : "N/A";
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
  if (growth.length === 0) {
    growth.push({ Month: "No sales data yet", Revenue: 0, "Bills Count": 0, "Items Sold": 0, "Avg Bill Value": 0, "Est. Profit": 0, "Profit Margin %": "N/A", "MoM Growth %": "N/A" });
  }

  // ── 5. Top Selling Items (active bills only) ──
  const itemSales: Record<string, { qty: number; revenue: number; cogs: number }> = {};
  activeBills.forEach((b) =>
    b.items.forEach((bi) => {
      if (!itemSales[bi.name]) itemSales[bi.name] = { qty: 0, revenue: 0, cogs: 0 };
      itemSales[bi.name].qty += bi.qty;
      itemSales[bi.name].revenue += bi.qty * bi.price;
      itemSales[bi.name].cogs += bi.qty * costOf(bi);
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
  if (topItems.length === 0) topItems.push({ Item: "No sales yet", "Units Sold": 0, Revenue: 0, "Est. Profit": 0 });

  // ── 6. Stock Movement Log ──
  const stockLog: Record<string, string | number>[] = [...logs]
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    .map((l) => ({
      Date: new Date(l.date).toLocaleString("en-IN"),
      Type: l.type === "in" ? "Stock In" : l.type === "out" ? "Stock Out" : "Bill / Sale",
      "Item / Bill": l.type === "bill" ? `Bill #${l.billNo}` : l.itemName ?? "",
      Qty: l.qty || "",
      Details:
        l.type === "bill"
          ? l.items ?? ""
          : (l.supplier ? `Supplier: ${l.supplier}` : l.reason || "") + (l.notes ? ` — ${l.notes}` : ""),
      [`Amount (${cur})`]: l.total || "",
    }));
  if (stockLog.length === 0) stockLog.push({ Date: "No activity yet", Type: "", "Item / Bill": "", Qty: "", Details: "", Amount: "" });

  // ── 7. Category P&L (per-category profit & loss, active bills only) ──
  const categoryPL: Record<string, string | number>[] = categoryPLData(bills, items).map((c) => ({
    Category: c.category,
    [`Revenue (${cur})`]: +c.revenue.toFixed(2),
    [`COGS (${cur})`]: +c.cogs.toFixed(2),
    [`Gross Profit (${cur})`]: +c.profit.toFixed(2),
    "Margin %": c.marginPct !== null ? c.marginPct.toFixed(1) + "%" : "N/A",
    "Revenue Share %": c.sharePct !== null ? c.sharePct.toFixed(1) + "%" : "N/A",
  }));
  if (categoryPL.length === 0)
    categoryPL.push({ Category: "No sales yet", Revenue: 0, COGS: 0, "Gross Profit": 0, "Margin %": "N/A", "Revenue Share %": "N/A" });

  // ── 8. Stock Health & Reorder (days-of-cover verdict per item) ──
  const stockHealth: Record<string, string | number>[] = stockHealthData(bills, items, bakery.lowStockAlert).map((s) => ({
    "Item Name": s.item.name,
    Category: s.item.category || "General",
    "Current Qty": s.item.qty,
    "Units Sold": +s.sold.toFixed(2),
    "Avg Sold / Day": +s.perDay.toFixed(2),
    "Days of Cover": s.daysCover !== null ? +s.daysCover.toFixed(1) : "∞",
    Verdict: s.verdict,
  }));
  if (stockHealth.length === 0)
    stockHealth.push({ "Item Name": "No items yet", Category: "", "Current Qty": 0, "Units Sold": 0, "Avg Sold / Day": 0, "Days of Cover": "", Verdict: "" });

  // ── 9. Recommendations (plain-language business boosters) ──
  const recommendations = recommendationsData(bills, items, bakery.lowStockAlert, cur).map((r) => ({
    Priority: r.priority,
    Insight: r.insight,
    Detail: r.detail,
  }));

  return { summary, inventory, sales, growth, topItems, stockLog, categoryPL, stockHealth, recommendations };
}

/** Build and download the Excel workbook. Loads `xlsx` on demand. */
export async function exportExcelReport(data: ReportData): Promise<ReportResult> {
  if (data.items.length === 0 && data.bills.length === 0) {
    return { ok: false, error: "⚠ No data yet to export" };
  }
  const XLSX = await import("xlsx");
  const now = new Date();
  const sheets = buildReportSheets(data, now);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.summary), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.inventory), "Inventory");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.sales), "Sales Report");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.growth), "Growth Analysis");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.topItems), "Top Selling Items");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.stockLog), "Stock Log");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.categoryPL), "Category P&L");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.stockHealth), "Stock Health");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets.recommendations), "Recommendations");

  const safeName = (data.bakery.name || "Bakery").replace(/[^a-z0-9]/gi, "_");
  const fileName = `${safeName}_Report_${now.toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return { ok: true };
}
