import { describe, it, expect } from "vitest";
import { gstSummarySheets } from "./gst-report";
import type { GstReportData } from "./gst-report";
import type { Bakery, Bill, BillConsumable, BillLine } from "./types";

const BAKERY = { currency: "₹" } as Bakery;
const ALL = { from: null, to: null };

const line = (over: Partial<BillLine> = {}): BillLine => ({
  itemId: "i1", name: "Cake", emoji: "🍰", imageUrl: null, unit: "pcs",
  qty: 1, price: 118, costPrice: 40,
  hsn: "1905", gstRate: 18, taxableValue: 100, cgst: 9, sgst: 9, igst: 0,
  ...over,
});

const consumable = (over: Partial<BillConsumable> = {}): BillConsumable => ({
  id: "bc1", consumableId: "c1", name: "Carry bag", unit: "pcs",
  qty: 1, unitCost: 11.8, charged: true,
  hsn: "4819", gstRate: 18, taxableValue: 10, cgst: 0.9, sgst: 0.9, igst: 0,
  ...over,
});

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1", billNo: 1, customerName: "", customerPhone: "",
  items: [], consumables: [],
  subtotal: 0, tax: 0, total: 0, taxRate: 0,
  paymentMethod: "Cash", discountPercent: 0, discountType: "percent", discountAmount: 0,
  shortfall: 0, shortfallNote: "", billerName: "",
  date: "2026-08-05T10:00:00.000Z", status: "active",
  invoiceType: "non_gst", invoiceNo: null, customerGstin: "", placeOfSupply: "",
  isInterstate: false, taxableValue: 0, cgst: 0, sgst: 0, igst: 0,
  ...over,
});

const data = (bills: Bill[]): GstReportData => ({ bakery: BAKERY, bills });

describe("gstSummarySheets", () => {
  it("returns the three filing sheets in order", () => {
    expect(gstSummarySheets(data([]), ALL).map((s) => s.name)).toEqual([
      "B2B", "B2C", "HSN Summary",
    ]);
  });

  it("puts a GST invoice with a customer GSTIN on B2B", () => {
    const sheets = gstSummarySheets(
      data([
        bill({
          invoiceType: "gst", invoiceNo: "GST/2026-27/0001",
          customerName: "Acme", customerGstin: "29ABCDE1234F1Z5", placeOfSupply: "29",
          taxableValue: 100, cgst: 9, sgst: 9, tax: 18, total: 118,
        }),
      ]),
      ALL,
    );
    const b2b = sheets[0].rows[0];
    expect(b2b["Invoice No"]).toBe("GST/2026-27/0001");
    expect(b2b["Customer GSTIN"]).toBe("29ABCDE1234F1Z5");
    expect(b2b["Taxable (₹)"]).toBe(100);
    expect(b2b["CGST (₹)"]).toBe(9);
    expect(b2b["Total (₹)"]).toBe(118);
    // A B2B invoice must not also be counted as B2C.
    expect(sheets[1].rows[0]["Place of Supply"]).toBe("No B2C invoices in range");
  });

  it("consolidates B2C invoices by place of supply", () => {
    const sheets = gstSummarySheets(
      data([
        bill({ id: "a", invoiceType: "gst", placeOfSupply: "29",
               taxableValue: 100, cgst: 9, sgst: 9, tax: 18, total: 118 }),
        bill({ id: "b", invoiceType: "gst", placeOfSupply: "29",
               taxableValue: 50, cgst: 4.5, sgst: 4.5, tax: 9, total: 59 }),
        bill({ id: "c", invoiceType: "gst", placeOfSupply: "07", isInterstate: true,
               taxableValue: 200, igst: 36, tax: 36, total: 236 }),
      ]),
      ALL,
    );
    const b2c = sheets[1].rows;
    expect(b2c).toHaveLength(2);
    const home = b2c.find((r) => r["Place of Supply"] === "29")!;
    expect(home.Invoices).toBe(2);
    expect(home["Taxable (₹)"]).toBe(150);
    expect(home["CGST (₹)"]).toBe(13.5);
    const away = b2c.find((r) => r["Place of Supply"] === "07")!;
    expect(away["IGST (₹)"]).toBe(36);
  });

  it("groups the HSN sheet by HSN and rate across bills", () => {
    const sheets = gstSummarySheets(
      data([
        bill({
          invoiceType: "gst",
          items: [line(), line({ hsn: "2106", gstRate: 5, qty: 2, taxableValue: 50, cgst: 1.25, sgst: 1.25 })],
        }),
        bill({ id: "b2", invoiceType: "gst", items: [line({ qty: 3, taxableValue: 300, cgst: 27, sgst: 27 })] }),
      ]),
      ALL,
    );
    const hsn = sheets[2].rows;
    expect(hsn).toHaveLength(2);
    const cake = hsn.find((r) => r.HSN === "1905")!;
    expect(cake["Rate %"]).toBe(18);
    expect(cake["Total Qty"]).toBe(4);
    expect(cake["Taxable (₹)"]).toBe(400);
    expect(cake["CGST (₹)"]).toBe(36);
  });

  it("keeps the same HSN at two rates as two rows", () => {
    const sheets = gstSummarySheets(
      data([
        bill({
          invoiceType: "gst",
          items: [line(), line({ gstRate: 5, taxableValue: 100, cgst: 2.5, sgst: 2.5 })],
        }),
      ]),
      ALL,
    );
    expect(sheets[2].rows).toHaveLength(2);
  });

  it("counts a charged consumable as a supply and ignores an absorbed one", () => {
    const sheets = gstSummarySheets(
      data([
        bill({
          invoiceType: "gst",
          items: [line()],
          consumables: [
            consumable(),
            consumable({ id: "bc2", name: "Foil", charged: false, hsn: "", gstRate: 0,
                         taxableValue: 0, cgst: 0, sgst: 0 }),
          ],
        }),
      ]),
      ALL,
    );
    const hsn = sheets[2].rows;
    expect(hsn.map((r) => r.HSN).sort()).toEqual(["1905", "4819"]);
  });

  it("excludes cancelled and non-GST bills entirely", () => {
    const sheets = gstSummarySheets(
      data([
        bill({ invoiceType: "gst", status: "cancelled", customerGstin: "29ABCDE1234F1Z5",
               taxableValue: 100, items: [line()] }),
        bill({ id: "n", invoiceType: "non_gst", total: 50, items: [line({ hsn: "", gstRate: 0 })] }),
      ]),
      ALL,
    );
    expect(sheets[0].rows[0]["Invoice No"]).toBe("No B2B invoices in range");
    expect(sheets[1].rows[0]["Place of Supply"]).toBe("No B2C invoices in range");
    expect(sheets[2].rows[0].HSN).toBe("No GST lines in range");
  });

  it("honours the date range", () => {
    const july = { from: "2026-07-01", to: "2026-07-31" };
    const sheets = gstSummarySheets(
      data([
        bill({ id: "in", invoiceType: "gst", date: "2026-07-15T10:00:00.000Z",
               placeOfSupply: "29", taxableValue: 100, total: 118 }),
        bill({ id: "out", invoiceType: "gst", date: "2026-08-15T10:00:00.000Z",
               placeOfSupply: "29", taxableValue: 500, total: 590 }),
      ]),
      july,
    );
    expect(sheets[1].rows).toHaveLength(1);
    expect(sheets[1].rows[0]["Taxable (₹)"]).toBe(100);
  });

  it("reconciles: B2B plus B2C taxable equals the HSN sheet's taxable", () => {
    const sheets = gstSummarySheets(
      data([
        bill({ id: "b2b", invoiceType: "gst", customerGstin: "29ABCDE1234F1Z5",
               placeOfSupply: "29", items: [line()], taxableValue: 100, total: 118 }),
        bill({ id: "b2c", invoiceType: "gst", placeOfSupply: "29",
               items: [line({ qty: 2, taxableValue: 200, cgst: 18, sgst: 18 })],
               taxableValue: 200, total: 236 }),
      ]),
      ALL,
    );
    const sum = (rows: Record<string, string | number>[]) =>
      rows.reduce((s, r) => s + (Number(r["Taxable (₹)"]) || 0), 0);
    expect(sum(sheets[0].rows) + sum(sheets[1].rows)).toBe(sum(sheets[2].rows));
  });
});
