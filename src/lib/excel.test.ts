import { describe, it, expect } from "vitest";
import { buildReportSheets } from "./excel";
import type { Bill, Item } from "./types";
import { DEFAULT_BAKERY } from "./constants";

const item: Item = {
  id: "i1", name: "Bread", emoji: "🍞", category: "Breads", unit: "pcs",
  price: 40, costPrice: 20, qty: 5,
};

const bill = (over: Partial<Bill>): Bill => ({
  id: "b", billNo: 1001, customerName: "", customerPhone: "",
  items: [{ itemId: "i1", name: "Bread", emoji: "🍞", unit: "pcs", qty: 2, price: 40, costPrice: 20 }],
  subtotal: 80, tax: 0, total: 80, taxRate: 0,
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
    const { growth, topItems, stockLog } = buildReportSheets(data, now);
    expect(growth[0].Month).toBe("No sales data yet");
    expect(topItems[0].Item).toBe("No sales yet");
    expect(stockLog[0].Date).toBe("No activity yet");
  });
});
