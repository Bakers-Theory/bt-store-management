import { describe, it, expect } from "vitest";
import { buildReportSheets } from "./excel";
import type { Bakery, Bill, Item } from "./types";

const DEFAULT_BAKERY: Bakery = {
  name: "My Bakery",
  tagline: "Fresh & Delicious",
  address: "123 Baker Street",
  phone: "9876543210",
  gst: "",
  logo: null,
  currency: "₹",
  taxRate: 0,
  lowStockAlert: 5,
  expiringSoonDays: 3,
  isOpen: true,
  statusChangedAt: null,
  statusChangedBy: "",
};

const item: Item = {
  id: "i1", name: "Bread", emoji: "🍞", category: "Breads", unit: "pcs",
  price: 40, costPrice: 20, qty: 5, tracksExpiry: true, earliestExpiry: null,
};

const bill = (over: Partial<Bill>): Bill => ({
  id: "b", billNo: 1001, customerName: "", customerPhone: "",
  items: [{ itemId: "i1", name: "Bread", emoji: "🍞", unit: "pcs", qty: 2, price: 40, costPrice: 20 }],
  subtotal: 80, tax: 0, total: 80, taxRate: 0, paymentMethod: "Cash", discountPercent: 0, billerName: "",
  date: "2026-06-01T10:00:00.000Z", status: "active", ...over,
});

const now = new Date("2026-07-02T00:00:00.000Z");

describe("buildReportSheets", () => {
  it("excludes cancelled bills from revenue but lists them in the sales sheet", () => {
    const data = {
      bakery: DEFAULT_BAKERY,
      items: [item],
      bills: [bill({ id: "b1" }), bill({ id: "b2", billNo: 1002, status: "cancelled" })],
      logs: [],
    };
    const { summary, sales, topItems } = buildReportSheets(data, now);

    const revenue = summary.find((r) => r.Metric === "Total Revenue (All Time)");
    expect(revenue?.Value).toBe("80.00"); // only the one active bill

    const cancelled = summary.find((r) => r.Metric === "Cancelled Bills");
    expect(cancelled?.Value).toBe(1);

    expect(sales).toHaveLength(2); // both listed
    expect(sales.map((r) => r.Status).sort()).toEqual(["Active", "Cancelled"]);

    // Top items counts only the active bill: 2 units sold
    expect(topItems[0]["Units Sold"]).toBe(2);
  });

  it("uses the line's recorded costPrice for COGS/profit", () => {
    const data = { bakery: DEFAULT_BAKERY, items: [item], bills: [bill({ id: "b1" })], logs: [] };
    const { summary } = buildReportSheets(data, now);
    // revenue 80, cogs = 2 * 20 = 40, profit = 40
    expect(summary.find((r) => r.Metric === "Total Gross Profit")?.Value).toBe("40.00");
  });

  it("emits placeholder rows when there is no data", () => {
    const data = { bakery: DEFAULT_BAKERY, items: [], bills: [], logs: [] };
    const { growth, topItems, stockLog, categoryPL, stockHealth, recommendations } = buildReportSheets(data, now);
    expect(growth[0].Month).toBe("No sales data yet");
    expect(topItems[0].Item).toBe("No sales yet");
    expect(stockLog[0].Date).toBe("No activity yet");
    expect(categoryPL[0].Category).toBe("No sales yet");
    expect(stockHealth[0]["Item Name"]).toBe("No items yet");
    expect(recommendations[0].Insight).toBe("Not enough data yet");
  });

  it("groups revenue, COGS and profit by category (active bills only)", () => {
    const data = {
      bakery: DEFAULT_BAKERY,
      items: [item],
      bills: [bill({ id: "b1" }), bill({ id: "b2", billNo: 1002, status: "cancelled" })],
      logs: [],
    };
    const { categoryPL } = buildReportSheets(data, now);
    // one active bill: 2 x Bread @40 => revenue 80, cogs 2*20=40, profit 40
    const row = categoryPL.find((r) => r.Category === "Breads");
    expect(row?.["Revenue (₹)"]).toBe(80);
    expect(row?.["COGS (₹)"]).toBe(40);
    expect(row?.["Gross Profit (₹)"]).toBe(40);
    expect(row?.["Margin %"]).toBe("50.0%");
    expect(row?.["Revenue Share %"]).toBe("100.0%");
  });

  it("flags dead stock and computes days of cover", () => {
    const soldItem: Item = { ...item, id: "i1", qty: 20 };
    const unsold: Item = { ...item, id: "i2", name: "Cake", qty: 3, category: "Cakes" };
    const data = {
      bakery: { ...DEFAULT_BAKERY, lowStockAlert: 2 },
      items: [soldItem, unsold],
      // two active bills a day apart => 2-day span, 4 units of Bread sold => 2/day => 10 days cover
      bills: [
        bill({ id: "b1", date: "2026-06-01T10:00:00.000Z" }),
        bill({ id: "b2", billNo: 1002, date: "2026-06-02T10:00:00.000Z" }),
      ],
      logs: [],
    };
    const { stockHealth } = buildReportSheets(data, now);
    const bread = stockHealth.find((r) => r["Item Name"] === "Bread");
    expect(bread?.["Units Sold"]).toBe(4);
    expect(bread?.["Avg Sold / Day"]).toBe(2);
    expect(bread?.["Days of Cover"]).toBe(10);
    expect(bread?.Verdict).toBe("Healthy");
    const cake = stockHealth.find((r) => r["Item Name"] === "Cake");
    expect(cake?.Verdict).toBe("Dead stock");
    expect(cake?.["Days of Cover"]).toBe("∞");
  });

  it("recommends reordering low-stock items that are still selling", () => {
    // qty 5 <= lowStockAlert 5, and it sold => Reorder now
    const data = {
      bakery: { ...DEFAULT_BAKERY, lowStockAlert: 5 },
      items: [item],
      bills: [bill({ id: "b1" })],
      logs: [],
    };
    const { recommendations } = buildReportSheets(data, now);
    const reorder = recommendations.find((r) => r.Insight.includes("Reorder") && r.Priority === "High");
    expect(reorder).toBeDefined();
    expect(reorder?.Detail).toContain("Bread");
  });
});
