import { describe, expect, it } from "vitest";
import {
  SUPPLIER_REPORT_TYPES,
  supplierReport,
  supplierReportSheets,
  supplierReportTables,
  type SupplierReportData,
} from "./supplier-report";
import type {
  PurchaseInvoice,
  PurchaseReturn,
  SupplierPayment,
  SupplierSummary,
} from "./types";

const shop = { name: "Bakers Theory", address: "12 Main St", phone: "9999", currency: "₹" };

const invoice = (over: Partial<PurchaseInvoice> = {}): PurchaseInvoice => ({
  id: "inv1",
  supplierId: "s1",
  supplierName: "Sharma Mills",
  supplierCode: "SUP-0001",
  supplierType: "external",
  invoiceNo: "INV-77",
  internalRef: null,
  purchaseDate: "2026-07-10",
  subtotal: 250,
  gstAmount: 12.5,
  total: 262.5,
  status: "posted",
  notes: "",
  createdByName: "Owner",
  createdAt: "2026-07-10T10:00:00Z",
  lines: [
    {
      id: "l1", itemId: "i1", itemName: "Flour", qty: 10, unitCost: 25,
      gstRate: 5, lineTotal: 250, expiry: null, returnedQty: 0,
    },
  ],
  cancelledAt: null,
  cancelReason: "",
  ...over,
});

const inHouseInvoice = (): PurchaseInvoice =>
  invoice({
    id: "inv2",
    supplierId: "s2",
    supplierName: "Bakery Kitchen",
    supplierCode: "SUP-0002",
    supplierType: "in_house",
    invoiceNo: null,
    internalRef: "IH-0001",
    purchaseDate: "2026-07-12",
    subtotal: 60,
    gstAmount: null,
    total: 60,
    lines: [
      {
        id: "l2", itemId: "i2", itemName: "Croissant dough", qty: 5, unitCost: 12,
        gstRate: 0, lineTotal: 60, expiry: null, returnedQty: 0,
      },
    ],
  });

const payment = (over: Partial<SupplierPayment> = {}): SupplierPayment => ({
  id: "p1", supplierId: "s1", supplierName: "Sharma Mills",
  invoiceId: "inv1", invoiceNo: "INV-77", amount: 200, paidOn: "2026-07-15",
  mode: "Bank Transfer", referenceNo: "NEFT-9931", createdByName: "Owner",
  createdAt: "2026-07-15T10:00:00Z", ...over,
});

const ret = (over: Partial<PurchaseReturn> = {}): PurchaseReturn => ({
  id: "r1", supplierId: "s1", supplierName: "Sharma Mills", invoiceId: "inv1",
  invoiceNo: "INV-77", returnDate: "2026-07-18", total: 75, status: "posted",
  reason: "Damaged in transit", createdByName: "Owner",
  createdAt: "2026-07-18T10:00:00Z", lines: [],
  cancelledAt: null, cancelReason: "", ...over,
});

const summary = (over: Partial<SupplierSummary> = {}): SupplierSummary => ({
  supplierId: "s1", supplierName: "Sharma Mills", supplierCode: "SUP-0001",
  supplierType: "external", totalPurchases: 262.5, totalPayments: 200,
  returnCredit: 75, outstanding: -12.5, inHouseValue: 0,
  lastTransactionDate: "2026-07-18", lastPaymentDate: "2026-07-15",
  purchaseOrderCount: 1, transactionCount: 3, ...over,
});

const data = (over: Partial<SupplierReportData> = {}): SupplierReportData => ({
  shop,
  invoices: [invoice(), inHouseInvoice()],
  payments: [payment()],
  returns: [ret()],
  summaries: [summary(), summary({
    supplierId: "s2", supplierName: "Bakery Kitchen", supplierCode: "SUP-0002",
    supplierType: "in_house", totalPurchases: 0, totalPayments: 0,
    returnCredit: 0, outstanding: 0, inHouseValue: 60,
    lastTransactionDate: "2026-07-12", lastPaymentDate: null,
    purchaseOrderCount: 1, transactionCount: 1,
  })],
  ...over,
});

const all = { from: null, to: null };

describe("every report type builds", () => {
  it("produces a PrintReport with a filename and at least one table", () => {
    for (const type of SUPPLIER_REPORT_TYPES) {
      const r = supplierReport(type, data(), all);
      expect(r.kind, type).toBe("report");
      expect(r.fileName, type).toBeTruthy();
      expect(r.tables.length, type).toBeGreaterThan(0);
      // Every totals row must match its table's column count, or the print
      // layout misaligns.
      for (const t of r.tables) {
        if (t.totals) expect(t.totals.length, type).toBe(t.columns.length);
        for (const row of t.rows) expect(row.length, type).toBe(t.columns.length);
      }
    }
  });

  it("produces Excel sheets keyed by the column headers", () => {
    for (const type of SUPPLIER_REPORT_TYPES) {
      const sheets = supplierReportSheets(type, data(), all);
      expect(sheets.length, type).toBeGreaterThan(0);
      for (const s of sheets) {
        expect(s.name, type).toBeTruthy();
        for (const row of s.rows) expect(Object.keys(row).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("supplier-wise purchases", () => {
  it("puts in-house in a separate section, never in the external totals", () => {
    const tables = supplierReportTables("supplierPurchases", data(), all);
    expect(tables).toHaveLength(2);
    const [external, inHouse] = tables;
    expect(external.rows.map((r) => r[0])).toEqual(["SUP-0001"]);
    expect(external.totals?.[external.totals.length - 1]).toBe(262.5);
    expect(inHouse.rows.map((r) => r[0])).toEqual(["SUP-0002"]);
  });

  it("omits the in-house section entirely when there is none", () => {
    const tables = supplierReportTables(
      "supplierPurchases",
      data({ invoices: [invoice()], summaries: [summary()] }),
      all,
    );
    expect(tables).toHaveLength(1);
  });
});

describe("product-wise purchases", () => {
  it("includes in-house rows and carries a type column", () => {
    const [table] = supplierReportTables("productPurchases", data(), all);
    expect(table.header).toContain("Type");
    const names = table.rows.map((r) => r[0]);
    expect(names).toContain("Flour");
    expect(names).toContain("Croissant dough");
  });

  it("aggregates repeat purchases of the same product", () => {
    const [table] = supplierReportTables(
      "productPurchases",
      data({
        invoices: [invoice(), invoice({ id: "inv3", invoiceNo: "INV-78" })],
        payments: [], returns: [],
      }),
      all,
    );
    const flour = table.rows.find((r) => r[0] === "Flour")!;
    expect(flour[table.header.indexOf("Qty")]).toBe(20);
    expect(flour[table.header.indexOf("Total cost")]).toBe(500);
  });
});

describe("outstanding payments", () => {
  it("excludes in-house by construction", () => {
    const [table] = supplierReportTables("outstanding", data(), all);
    expect(table.rows.map((r) => r[0])).toEqual(["SUP-0001"]);
  });

  it("omits suppliers who owe nothing", () => {
    const [table] = supplierReportTables(
      "outstanding",
      data({ summaries: [summary({ outstanding: 0 })] }),
      all,
    );
    expect(table.rows).toHaveLength(0);
    expect(table.empty).toBeTruthy();
  });
});

describe("purchase history", () => {
  it("includes both types with a type column, newest first", () => {
    const [table] = supplierReportTables("purchaseHistory", data(), all);
    expect(table.header).toContain("Type");
    expect(table.rows[0][0]).toBe("2026-07-12"); // the in-house receipt is later
    expect(table.rows).toHaveLength(2);
  });

  it("shows the in-house reference where an invoice number would be", () => {
    const [table] = supplierReportTables("purchaseHistory", data(), all);
    const refs = table.rows.map((r) => r[table.header.indexOf("Reference")]);
    expect(refs).toContain("IH-0001");
    expect(refs).toContain("INV-77");
  });
});

describe("GST purchases", () => {
  it("excludes in-house by construction", () => {
    const [table] = supplierReportTables("gstPurchases", data(), all);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][table.header.indexOf("Invoice")]).toBe("INV-77");
  });

  it("omits invoices that carry no GST", () => {
    const [table] = supplierReportTables(
      "gstPurchases",
      data({ invoices: [invoice({ gstAmount: 0, total: 250 })] }),
      all,
    );
    expect(table.rows).toHaveLength(0);
  });
});

describe("payment history", () => {
  it("excludes in-house by construction and totals the amounts", () => {
    const [table] = supplierReportTables("paymentHistory", data(), all);
    expect(table.rows).toHaveLength(1);
    expect(table.totals?.[table.totals.length - 1]).toBe(200);
  });
});

describe("date filtering", () => {
  it("keeps only rows inside the range, per report", () => {
    const range = { from: "2026-07-11", to: "2026-07-16" };
    const [hist] = supplierReportTables("purchaseHistory", data(), range);
    expect(hist.rows).toHaveLength(1);           // only the 12th
    const [pay] = supplierReportTables("paymentHistory", data(), range);
    expect(pay.rows).toHaveLength(1);            // the 15th
    const [gst] = supplierReportTables("gstPurchases", data(), range);
    expect(gst.rows).toHaveLength(0);            // the 10th is outside
  });

  it("labels the period on the printed report", () => {
    const r = supplierReport("purchaseHistory", data(), { from: "2026-07-01", to: "2026-07-31" });
    expect(r.period).toContain("Jul");
  });
});

describe("draft and cancelled rows", () => {
  it("never counts an unposted invoice", () => {
    const [table] = supplierReportTables(
      "purchaseHistory",
      data({ invoices: [invoice({ status: "draft" }), invoice({ id: "x", status: "cancelled" })] }),
      all,
    );
    expect(table.rows).toHaveLength(0);
  });

  it("never counts an unposted return", () => {
    const [table] = supplierReportTables(
      "outstanding",
      data({ returns: [ret({ status: "draft" })] }),
      all,
    );
    // The summary view already excludes it; this asserts the builder does not
    // re-add it from the raw list.
    expect(table.rows[0][table.header.indexOf("Return credit")]).toBe(75);
  });
});
