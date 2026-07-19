import { describe, it, expect } from "vitest";
import {
  inRange, formatDMY, ymdToDMY, isoDateLocal, reportFileName, headerRows,
  buildProductsReport, buildStockReport, buildCustomersReport,
  buildBillsReport, buildSalesReport, buildStockLogReport,
  buildAnalyticsReport, buildFullReport, buildReport, buildExpiryReport,
} from "./excel";
import type { Bakery, Bill, Customer, Item } from "./types";

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
  id: "i1", name: "Bread", emoji: "🍞", imageUrl: null, category: "Breads", unit: "pcs",
  price: 40, costPrice: 20, qty: 5, tracksExpiry: true, earliestExpiry: null, batches: [],
};

const bill = (over: Partial<Bill>): Bill => ({
  id: "b", billNo: 1001, customerName: "", customerPhone: "",
  items: [{ itemId: "i1", name: "Bread", emoji: "🍞", imageUrl: null, unit: "pcs", qty: 2, price: 40, costPrice: 20 }],
  subtotal: 80, tax: 0, total: 80, taxRate: 0, paymentMethod: "Cash", discountPercent: 0,
  discountType: "percent", discountAmount: 0, billerName: "",
  date: "2026-06-01T10:00:00.000Z", status: "active", ...over,
});

describe("date & filename helpers", () => {
  const range = { from: "2026-07-01", to: "2026-07-31" };

  it("inRange: inclusive bounds and open ends", () => {
    expect(inRange("2026-07-01T05:00:00.000Z", range)).toBe(true); // lower boundary
    expect(inRange("2026-07-31T23:00:00.000Z", range)).toBe(true); // upper boundary
    expect(inRange("2026-06-30T23:00:00.000Z", range)).toBe(false);
    expect(inRange("2026-08-01T00:00:00.000Z", range)).toBe(false);
    expect(inRange("2020-01-01T00:00:00.000Z", { from: null, to: null })).toBe(true);
    expect(inRange("2026-06-15T00:00:00.000Z", { from: "2026-07-01", to: null })).toBe(false);
    expect(inRange("2026-09-15T00:00:00.000Z", { from: null, to: "2026-07-31" })).toBe(false);
  });

  it("ymdToDMY reorders without timezone drift", () => {
    expect(ymdToDMY("2026-07-01")).toBe("01-07-2026");
  });

  it("isoDateLocal formats a local YYYY-MM-DD", () => {
    expect(isoDateLocal(new Date(2026, 6, 5))).toBe("2026-07-05");
  });

  it("reportFileName covers range, one-sided, all, and snapshot", () => {
    const bk = { name: "Sweet Treats!" } as never;
    const nowD = new Date("2026-07-13T00:00:00.000Z");
    expect(reportFileName(bk, "sales", range, nowD)).toBe("Sweet_Treats__Sales_01-07-2026_to_31-07-2026.xlsx");
    expect(reportFileName(bk, "bills", { from: "2026-07-01", to: null }, nowD)).toBe("Sweet_Treats__Bills_from_01-07-2026.xlsx");
    expect(reportFileName(bk, "bills", { from: null, to: "2026-07-31" }, nowD)).toBe("Sweet_Treats__Bills_upto_31-07-2026.xlsx");
    expect(reportFileName(bk, "analytics", { from: null, to: null }, nowD)).toBe("Sweet_Treats__Analytics_all.xlsx");
    expect(reportFileName(bk, "products", { from: null, to: null }, nowD)).toBe("Sweet_Treats__Products_snapshot.xlsx");
  });

  it("headerRows shows the right period line", () => {
    const bk = { name: "My Bakery" } as never;
    const nowD = new Date("2026-07-13T10:00:00.000Z");
    expect(headerRows(bk, "Sales", range, nowD, false)[2][0]).toBe("Period: 01-07-2026 to 31-07-2026");
    expect(headerRows(bk, "Sales", { from: null, to: null }, nowD, false)[2][0]).toBe("All records");
    expect(headerRows(bk, "Products", { from: null, to: null }, nowD, true)[2][0])
      .toBe("Snapshot as of " + formatDMY(nowD));
  });
});

describe("snapshot builders", () => {
  const nowD = new Date("2026-07-13T00:00:00.000Z");
  const expItem: Item = {
    ...item, id: "i2", name: "Cake", tracksExpiry: true, earliestExpiry: "2026-07-01",
    qty: 6, batches: [
      { qty: 2, expiryDate: "2026-07-01" }, // expired (before 2026-07-13)
      { qty: 4, expiryDate: "2026-07-20" },
    ],
  };
  const data = { bakery: DEFAULT_BAKERY, items: [item, expItem], bills: [], logs: [], customers: [] };

  it("Products report includes expiry columns", () => {
    const rows = buildProductsReport(data, nowD)[0].rows;
    const cake = rows.find((r) => r["Item Name"] === "Cake")!;
    expect(cake["Tracks Expiry"]).toBe("Yes");
    expect(cake["Earliest Expiry"]).toBe("01-07-2026");
  });

  it("Stock report computes expired units and batch string", () => {
    const rows = buildStockReport(data, nowD)[0].rows;
    const cake = rows.find((r) => r["Item Name"] === "Cake")!;
    expect(cake["Batch Count"]).toBe(2);
    expect(cake["Expired Units"]).toBe(2);
    expect(String(cake["Batches"])).toContain("01-07-2026");
  });

  it("snapshot builders emit placeholders when empty and format customers", () => {
    const empty = { ...data, items: [], customers: [] };
    expect(buildProductsReport(empty, nowD)[0].rows[0]["Item Name"]).toBe("No products yet");
    const custs: Customer[] = [{
      id: "c1", phone: "999", name: "Ann", firstSeen: "2026-01-01T00:00:00.000Z",
      visitCount: 3, totalSpend: 500, lastPurchase: null,
    }];
    const cRows = buildCustomersReport({ ...data, customers: custs }, nowD)[0].rows;
    expect(cRows[0]["Name"]).toBe("Ann");
    expect(cRows[0]["Last Purchase"]).toBe("—");
  });
});

describe("event builders (date-filtered)", () => {
  const nowD = new Date("2026-08-01T00:00:00.000Z");
  const july = { from: "2026-07-01", to: "2026-07-31" };
  const data = {
    bakery: DEFAULT_BAKERY, items: [item], customers: [], logs: [
      { id: "l1", type: "in" as const, date: "2026-07-05T10:00:00.000Z", itemName: "Bread", qty: 10 },
      { id: "l2", type: "in" as const, date: "2026-06-05T10:00:00.000Z", itemName: "Bread", qty: 5 },
    ],
    bills: [
      bill({ id: "b1", date: "2026-07-10T10:00:00.000Z" }),
      bill({ id: "b2", billNo: 1002, date: "2026-07-31T23:00:00.000Z" }), // boundary, included
      bill({ id: "b3", billNo: 1003, date: "2026-06-15T10:00:00.000Z" }), // excluded
    ],
  };

  it("Bills report keeps only in-range bills (boundary inclusive)", () => {
    const rows = buildBillsReport(data, july, nowD)[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r["Bill No"]).sort()).toEqual([1001, 1002]);
  });

  it("Sales report aggregates in-range active bills by month", () => {
    const rows = buildSalesReport(data, july, nowD)[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].Month).toBe("2026-07");
    expect(rows[0]["Bills Count"]).toBe(2);
  });

  it("Stock Log report filters by date and emits placeholder when empty", () => {
    expect(buildStockLogReport(data, july, nowD)[0].rows).toHaveLength(1);
    expect(buildStockLogReport({ ...data, logs: [] }, july, nowD)[0].rows[0].Date).toBe("No activity in range");
  });
});

describe("analytics builder", () => {
  const nowD = new Date("2026-08-01T00:00:00.000Z");
  const july = { from: "2026-07-01", to: "2026-07-31" };
  const data = {
    bakery: DEFAULT_BAKERY, items: [item], logs: [], customers: [],
    bills: [
      bill({ id: "b1", date: "2026-07-10T10:00:00.000Z" }),      // in range
      bill({ id: "b2", billNo: 1002, date: "2026-06-10T10:00:00.000Z" }), // out of range
    ],
  };

  it("produces the four analytics sheets from in-range bills only", () => {
    const sheets = buildAnalyticsReport(data, july, nowD);
    expect(sheets.map((s) => s.name)).toEqual([
      "Top Selling Items", "Category P&L", "Stock Health", "Recommendations",
    ]);
    const top = sheets[0].rows;
    expect(top[0]["Units Sold"]).toBe(2); // only the July bill's 2 units
  });
});

describe("full report", () => {
  const nowD = new Date("2026-08-01T00:00:00.000Z");
  const open = { from: null, to: null };
  const data = {
    bakery: DEFAULT_BAKERY, items: [item], logs: [], customers: [],
    bills: [bill({ id: "b1" }), bill({ id: "b2", billNo: 1002, status: "cancelled" as const })],
  };

  it("includes a Summary sheet plus every report section", () => {
    const names = buildFullReport(data, open, nowD).map((s) => s.name);
    expect(names).toEqual([
      "Summary", "Sales", "Bills", "Products", "Stock", "Expiry & Wastage", "Stock Log", "Customers",
      "Top Selling Items", "Category P&L", "Stock Health", "Recommendations",
    ]);
  });

  it("Summary counts active vs cancelled bills", () => {
    const summary = buildFullReport(data, open, nowD)[0].rows;
    expect(summary.find((r) => r.Metric === "Cancelled Bills")?.Value).toBe(1);
    expect(summary.find((r) => r.Metric === "Total Revenue")?.Value).toBe("80.00");
  });

  it("buildReport dispatches by type with correct metadata", () => {
    const r = buildReport("products", data, open, nowD);
    expect(r.reportName).toBe("Products");
    expect(r.isSnapshot).toBe(true);
    expect(r.sheets[0].name).toBe("Products");
  });
});

describe("expiry & wastage builder", () => {
  // now = 2026-07-13; expiringSoonDays default 3 => soon window through 2026-07-16
  const nowD = new Date(2026, 6, 13);
  const cake: Item = {
    ...item, id: "i2", name: "Cake", costPrice: 30, qty: 9, batches: [
      { qty: 2, expiryDate: "2026-07-01" }, // expired
      { qty: 3, expiryDate: "2026-07-15" }, // expiring soon (<= 2026-07-16)
      { qty: 4, expiryDate: "2026-08-20" }, // fine
    ],
  };
  const bread: Item = { ...item, id: "i3", name: "Bun", batches: [{ qty: 5, expiryDate: "2026-12-01" }] };
  const data = { bakery: DEFAULT_BAKERY, items: [cake, bread], bills: [], logs: [], customers: [] };

  it("lists only at-risk items with expired/soon units and value", () => {
    const rows = buildExpiryReport(data, nowD)[0].rows;
    expect(rows).toHaveLength(1); // Bun has no at-risk stock
    const c = rows[0];
    expect(c["Item Name"]).toBe("Cake");
    expect(c["Expired Units"]).toBe(2);
    expect(c["Expiring Soon Units"]).toBe(3);
    expect(c["Expired Value at Cost (₹)"]).toBe(60);       // 2 * 30
    expect(c["Expiring Soon Value at Cost (₹)"]).toBe(90); // 3 * 30
  });

  it("emits a placeholder when nothing is at risk", () => {
    const rows = buildExpiryReport({ ...data, items: [bread] }, nowD)[0].rows;
    expect(rows[0]["Item Name"]).toBe("No expiring or expired stock");
  });
});
