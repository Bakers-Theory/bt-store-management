import { describe, expect, it } from "vitest";
import {
  CONSUMABLE_REPORT_META,
  CONSUMABLE_REPORT_TYPES,
  consumableReport,
  consumableReportCsv,
  consumableReportSheets,
  consumableReportTables,
  type ConsumableReportData,
} from "./consumable-report";
import type { Consumable, StockMovement } from "./types";

const shop = { name: "Bakers Theory", address: "MG Road", phone: "9876543210", currency: "₹" };

const item = (over: Partial<Consumable> = {}): Consumable => ({
  id: "c1",
  code: "CON-0001",
  name: "Cake boxes",
  category: "Packaging",
  unit: "pcs",
  vendorId: null,
  vendorName: "BoxCo",
  minStock: 100,
  maxStock: 500,
  reorderLevel: null,
  reorderQty: null,
  costPerUnit: 8,
  expiryDate: null,
  storageLocation: "Store room",
  notes: "",
  currentStock: 250,
  lastPurchaseDate: "2026-07-02",
  lastPurchaseCost: 10,
  lastMovementDate: "2026-07-10",
  stockStatus: "ok",
  recommendedQty: 0,
  expiryDaysLeft: null,
  stockValue: 2500,
  createdAt: "2026-01-01T00:00:00Z",
  createdByName: "Owner",
  updatedAt: "2026-07-10T00:00:00Z",
  updatedByName: "Owner",
  ...over,
});

const move = (over: Partial<StockMovement> = {}): StockMovement => ({
  id: "m1",
  consumableId: "c1",
  itemCode: "CON-0001",
  itemName: "Cake boxes",
  itemCategory: "Packaging",
  unit: "pcs",
  movementType: "purchase",
  qty: 100,
  qtySigned: 100,
  onDate: "2026-07-02",
  unitCost: 10,
  movementValue: 1000,
  vendorId: null,
  vendorName: "BoxCo",
  issuedTo: null,
  issuedToName: "",
  reason: "",
  remarks: "",
  createdById: "u1",
  createdByName: "Owner",
  createdAt: "2026-07-02T00:00:00Z",
  ...over,
});

const data = (over: Partial<ConsumableReportData> = {}): ConsumableReportData => ({
  shop,
  items: [item()],
  movements: [move()],
  ...over,
});

const july = { from: "2026-07-01", to: "2026-07-31" };
const all = { from: null, to: null };

describe("report metadata", () => {
  it("marks the position reports as snapshots and the event reports as windows", () => {
    const snapshots = CONSUMABLE_REPORT_TYPES.filter((t) => CONSUMABLE_REPORT_META[t].snapshot);
    expect(snapshots).toEqual(["inventory", "expiry"]);
  });

  it("gives every report a unique sheet slug", () => {
    const slugs = CONSUMABLE_REPORT_TYPES.map((t) => CONSUMABLE_REPORT_META[t].slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("builds every report without throwing, empty or not", () => {
    for (const t of CONSUMABLE_REPORT_TYPES) {
      expect(() => consumableReport(t, data(), july)).not.toThrow();
      expect(() => consumableReport(t, { shop, items: [], movements: [] }, july)).not.toThrow();
    }
  });
});

describe("inventory report", () => {
  it("reports stock, its value and the level tier", () => {
    const [table] = consumableReportTables("inventory", data(), all);
    expect(table.rows[0]).toEqual([
      "CON-0001", "Cake boxes", "Packaging", "pcs", 250, 100, 500, 2500, "In stock",
    ]);
  });

  it("counts what needs action in the totals", () => {
    const d = data({
      items: [
        item({ id: "c1", stockStatus: "low" }),
        item({ id: "c2", stockStatus: "out" }),
        item({ id: "c3", stockStatus: "ok" }),
      ],
    });
    const [table] = consumableReportTables("inventory", d, all);
    expect(table.totals?.[8]).toBe("2 need action");
  });

  it("drops trailing zeros from a three-decimal quantity", () => {
    const d = data({ items: [item({ currentStock: 2.5, minStock: 1 })] });
    const [table] = consumableReportTables("inventory", d, all);
    expect(table.rows[0][4]).toBe(2.5);
  });

  it("leaves the maximum blank when none is set, rather than showing zero", () => {
    const d = data({ items: [item({ maxStock: null })] });
    const [table] = consumableReportTables("inventory", d, all);
    expect(table.rows[0][6]).toBe("");
  });
});

describe("stock movement report", () => {
  it("splits in and out into separate columns by the movement's direction", () => {
    const d = data({
      movements: [
        move({ id: "m1", movementType: "purchase", qty: 100, qtySigned: 100 }),
        move({ id: "m2", movementType: "issue", qty: 40, qtySigned: -40, onDate: "2026-07-05" }),
      ],
    });
    const [table] = consumableReportTables("movement", d, july);
    const [issue, purchase] = table.rows; // newest first
    expect(issue[4]).toBe("");
    expect(issue[5]).toBe(40);
    expect(purchase[4]).toBe(100);
    expect(purchase[5]).toBe("");
    expect(table.totals?.[4]).toBe(100);
    expect(table.totals?.[5]).toBe(40);
  });

  it("filters by the date the stock moved", () => {
    const d = data({
      movements: [move({ onDate: "2026-06-30" }), move({ id: "m2", onDate: "2026-07-01" })],
    });
    expect(consumableReportTables("movement", d, july)[0].rows).toHaveLength(1);
  });

  it("falls back to remarks when a movement carries no reason", () => {
    const d = data({ movements: [move({ reason: "", remarks: "Opening count" })] });
    expect(consumableReportTables("movement", d, july)[0].rows[0][7]).toBe("Opening count");
  });
});

describe("consumption report", () => {
  it("counts outward movement only, so a purchase never cancels usage", () => {
    const d = data({
      movements: [
        move({ id: "m1", movementType: "purchase", qty: 100, qtySigned: 100 }),
        move({ id: "m2", movementType: "issue", qty: 30, qtySigned: -30 }),
      ],
    });
    const [table] = consumableReportTables("consumption", d, july);
    expect(table.rows[0][3]).toBe(30); // issued
    expect(table.rows[0][6]).toBe(30); // total out — the purchase is absent
  });

  it("separates issued from written off and adjusted", () => {
    const d = data({
      movements: [
        move({ id: "m1", movementType: "issue", qty: 10, qtySigned: -10 }),
        move({ id: "m2", movementType: "wastage", qty: 4, qtySigned: -4, reason: "Torn" }),
        move({ id: "m3", movementType: "expired", qty: 1, qtySigned: -1, reason: "Old" }),
        move({ id: "m4", movementType: "adjustment", qty: -2, qtySigned: -2, reason: "Count" }),
      ],
    });
    const [table] = consumableReportTables("consumption", d, july);
    expect(table.rows[0].slice(3, 7)).toEqual([10, 5, 2, 17]);
  });

  it("values usage at the latest purchase price, not the recorded cost", () => {
    // lastPurchaseCost 10 wins over costPerUnit 8.
    const d = data({ movements: [move({ movementType: "issue", qty: 10, qtySigned: -10 })] });
    expect(consumableReportTables("consumption", d, july)[0].rows[0][7]).toBe(100);
  });

  it("falls back to the recorded cost when nothing has been bought", () => {
    const d = data({
      items: [item({ lastPurchaseCost: null, costPerUnit: 8 })],
      movements: [move({ movementType: "issue", qty: 10, qtySigned: -10 })],
    });
    expect(consumableReportTables("consumption", d, july)[0].rows[0][7]).toBe(80);
  });

  it("puts the heaviest user first", () => {
    const d = data({
      items: [item({ id: "c1" }), item({ id: "c2", name: "Paper bags", code: "CON-0002" })],
      movements: [
        move({ id: "m1", consumableId: "c1", movementType: "issue", qty: 5, qtySigned: -5 }),
        move({
          id: "m2", consumableId: "c2", itemCode: "CON-0002", itemName: "Paper bags",
          movementType: "issue", qty: 50, qtySigned: -50,
        }),
      ],
    });
    const [table] = consumableReportTables("consumption", d, july);
    expect(table.rows[0][0]).toBe("CON-0002");
  });
});

describe("purchase report", () => {
  it("reports quantity, spend and the average actually paid", () => {
    const d = data({
      movements: [
        move({ id: "m1", qty: 100, qtySigned: 100, unitCost: 10, movementValue: 1000 }),
        move({ id: "m2", qty: 100, qtySigned: 100, unitCost: 12, movementValue: 1200 }),
      ],
    });
    const [table] = consumableReportTables("purchase", d, july);
    expect(table.rows[0].slice(3, 6)).toEqual([200, 2200, 11]);
  });

  it("counts purchases only, not returns", () => {
    const d = data({
      movements: [
        move({ id: "m1", movementType: "purchase", qty: 100, qtySigned: 100 }),
        move({ id: "m2", movementType: "return", qty: 5, qtySigned: 5 }),
      ],
    });
    expect(consumableReportTables("purchase", d, july)[0].rows[0][3]).toBe(100);
  });

  it("carries §3.5's suggested orders as a snapshot section", () => {
    const d = data({
      items: [item({ currentStock: 20, recommendedQty: 480, stockStatus: "low" })],
      movements: [],
    });
    const [bought, suggested] = consumableReportTables("purchase", d, july);
    expect(bought.rows).toHaveLength(0);
    expect(suggested.rows[0][5]).toBe(480);
    expect(suggested.rows[0][6]).toBe(4800); // 480 × latest cost of 10
  });
});

describe("expiry report", () => {
  it("lists only items that carry an expiry date", () => {
    const d = data({
      items: [
        item({ id: "c1", expiryDate: "2026-08-20", expiryDaysLeft: 15 }),
        item({ id: "c2", expiryDate: null }),
      ],
    });
    const [table] = consumableReportTables("expiry", d, all);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][8]).toBe("Expiring soon");
  });

  it("distinguishes expired, expiring and in date", () => {
    const d = data({
      items: [
        item({ id: "c1", expiryDate: "2026-01-01", expiryDaysLeft: -100 }),
        item({ id: "c2", expiryDate: "2026-08-10", expiryDaysLeft: 5 }),
        item({ id: "c3", expiryDate: "2027-01-01", expiryDaysLeft: 400 }),
      ],
    });
    const [table] = consumableReportTables("expiry", d, all);
    expect(table.rows.map((r) => r[8])).toEqual(["Expired", "Expiring soon", "In date"]);
  });

  it("values only what still has stock — an empty expired item has lost nothing", () => {
    const d = data({
      items: [
        item({ id: "c1", expiryDate: "2026-01-01", expiryDaysLeft: -100, currentStock: 0, stockValue: 0 }),
        item({ id: "c2", expiryDate: "2026-08-10", expiryDaysLeft: 5, currentStock: 10, stockValue: 100 }),
      ],
    });
    const [table] = consumableReportTables("expiry", d, all);
    expect(table.totals?.[7]).toBe(100);
    expect(table.totals?.[8]).toBe("0 expired with stock");
  });
});

describe("wastage report", () => {
  it("covers wastage, expiry and damage — and nothing else", () => {
    const d = data({
      movements: [
        move({ id: "m1", movementType: "wastage", qty: 4, qtySigned: -4, reason: "Torn" }),
        move({ id: "m2", movementType: "expired", qty: 2, qtySigned: -2, reason: "Old" }),
        move({ id: "m3", movementType: "damaged", qty: 1, qtySigned: -1, reason: "Crushed" }),
        move({ id: "m4", movementType: "issue", qty: 9, qtySigned: -9 }),
      ],
    });
    const [table] = consumableReportTables("wastage", d, july);
    expect(table.rows).toHaveLength(3);
    expect(table.totals?.[6]).toBe(70); // (4+2+1) × 10
  });

  it("breaks the loss down by type", () => {
    const d = data({
      movements: [move({ movementType: "wastage", qty: 4, qtySigned: -4, reason: "Torn" })],
    });
    const [, byType] = consumableReportTables("wastage", d, july);
    expect(byType.rows).toEqual([
      ["Wastage", 1, 4, 40],
      ["Expired", 0, 0, 0],
      ["Damaged", 0, 0, 0],
    ]);
  });

  it("always has a reason to show, because the system requires one", () => {
    const d = data({
      movements: [move({ movementType: "damaged", qty: 1, qtySigned: -1, reason: "Forklift" })],
    });
    expect(consumableReportTables("wastage", d, july)[0].rows[0][7]).toBe("Forklift");
  });
});

describe("renderers", () => {
  it("formats money for print and keeps it numeric for Excel", () => {
    expect(consumableReport("inventory", data(), all).tables[0].rows[0][7]).toBe("₹2500.00");
    expect(consumableReportSheets("inventory", data(), all)[0].rows[0]["Value"]).toBe(2500);
  });

  it("does not money-format a quantity column", () => {
    const printed = consumableReport("inventory", data(), all);
    expect(printed.tables[0].rows[0][4]).toBe(250);
  });

  it("pads totals to the column count", () => {
    for (const t of CONSUMABLE_REPORT_TYPES) {
      for (const table of consumableReport(t, data(), july).tables) {
        if (table.totals) expect(table.totals).toHaveLength(table.columns.length);
      }
    }
  });

  it("says 'As of today' for a snapshot and the range otherwise", () => {
    expect(consumableReport("inventory", data(), july).period).toBe("As of today");
    expect(consumableReport("wastage", data(), july).period).toBe("1 Jul 2026 – 31 Jul 2026");
  });

  it("writes one CSV per report with a block per table", () => {
    const csv = consumableReportCsv("purchase", data(), july);
    expect(csv).toContain("Suggested orders");
    expect(csv.split("\r\n\r\n").length).toBe(2);
  });

  it("carries a note explaining how value was estimated", () => {
    for (const t of ["consumption", "wastage"] as const) {
      expect(consumableReport(t, data(), july).note).toContain("estimate");
    }
  });
});
