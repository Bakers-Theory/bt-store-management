import { describe, expect, it } from "vitest";
import {
  balanceRows,
  invoiceTotals,
  isPurchaseMode,
  isReturnQtyValid,
  lineGst,
  lineTotal,
  outstandingBalance,
  returnableQty,
  summaryTotals,
  validateInvoiceDraft,
  type DraftLine,
} from "./purchase";
import type { SupplierSummary } from "./types";

const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  itemId: "i1",
  qty: 10,
  unitCost: 25,
  gstRate: 5,
  expiry: null,
  ...over,
});

describe("line arithmetic", () => {
  it("multiplies qty by unit cost, rounded to paise", () => {
    expect(lineTotal(3, 33.333)).toBe(100);
    expect(lineTotal(10, 25)).toBe(250);
  });
  it("takes GST as a percentage of the line total", () => {
    expect(lineGst(10, 25, 5)).toBe(12.5);
    expect(lineGst(10, 25, 0)).toBe(0);
  });
});

describe("invoiceTotals — external", () => {
  it("sums the lines and their GST", () => {
    const t = invoiceTotals([line(), line({ qty: 4, unitCost: 50, gstRate: 12 })], "external");
    expect(t.subtotal).toBe(450);        // 250 + 200
    expect(t.gstAmount).toBe(36.5);      // 12.50 + 24.00
    expect(t.total).toBe(486.5);
  });
  it("allows a zero GST rate without turning the field null", () => {
    const t = invoiceTotals([line({ gstRate: 0 })], "external");
    expect(t.gstAmount).toBe(0);
    expect(t.total).toBe(250);
  });
  it("keeps total = subtotal + gst on repeating decimals", () => {
    const t = invoiceTotals([line({ qty: 3, unitCost: 33.333, gstRate: 18 })], "external");
    expect(t.total).toBe(Number((t.subtotal + (t.gstAmount ?? 0)).toFixed(2)));
  });
  it("returns zeroes for an empty invoice", () => {
    expect(invoiceTotals([], "external")).toEqual({ subtotal: 0, gstAmount: 0, total: 0 });
  });
});

describe("invoiceTotals — in-house", () => {
  it("nulls GST entirely and ignores any rate that was entered", () => {
    const t = invoiceTotals([line({ gstRate: 18 })], "in_house");
    expect(t.gstAmount).toBeNull();
    expect(t.subtotal).toBe(250);
    expect(t.total).toBe(250);
  });
});

describe("return caps", () => {
  it("is purchased minus already returned", () => {
    expect(returnableQty(10, 3)).toBe(7);
    expect(returnableQty(10, 0)).toBe(10);
  });
  it("never goes negative, even on inconsistent data", () => {
    expect(returnableQty(10, 12)).toBe(0);
  });
  it("accepts a return up to the cap and refuses one past it", () => {
    expect(isReturnQtyValid(7, 10, 3)).toBe(true);
    expect(isReturnQtyValid(7.01, 10, 3)).toBe(false);
    expect(isReturnQtyValid(0, 10, 3)).toBe(false); // a zero return is not a return
    expect(isReturnQtyValid(-1, 10, 3)).toBe(false);
  });
});

describe("outstandingBalance", () => {
  it("is purchases less payments less return credit", () => {
    expect(outstandingBalance(1000, 400, 150)).toBe(450);
  });
  it("can go negative — an overpayment is a real state worth showing", () => {
    expect(outstandingBalance(100, 250, 0)).toBe(-150);
  });
});

const row = (over: Partial<SupplierSummary>): SupplierSummary => ({
  supplierId: "s1", supplierName: "S", supplierCode: "SUP-0001",
  supplierType: "external", totalPurchases: 0, totalPayments: 0,
  returnCredit: 0, outstanding: 0, inHouseValue: 0,
  lastTransactionDate: null, lastPaymentDate: null,
  purchaseOrderCount: 0, transactionCount: 0,
  ...over,
});

describe("summaryTotals", () => {
  it("excludes in-house rows from every payable total", () => {
    const t = summaryTotals([
      row({ totalPurchases: 1000, totalPayments: 400, returnCredit: 100, outstanding: 500 }),
      row({ supplierId: "s2", supplierType: "in_house", inHouseValue: 900 }),
    ]);
    expect(t.purchases).toBe(1000);
    expect(t.payments).toBe(400);
    expect(t.returnCredit).toBe(100);
    expect(t.outstanding).toBe(500);
    expect(t.inHouseValue).toBe(900);
  });

  it("counts only external suppliers who actually owe something", () => {
    const t = summaryTotals([
      row({ outstanding: 500 }),
      row({ supplierId: "s2", outstanding: 0 }),
      row({ supplierId: "s3", supplierType: "in_house", inHouseValue: 100 }),
    ]);
    expect(t.suppliersOwing).toBe(1);
  });
});

describe("balanceRows", () => {
  const all = { search: "", owingOnly: false };
  const ids = (rows: SupplierSummary[]) => rows.map((r) => r.supplierId);

  it("drops in-house suppliers — they can never be a payable", () => {
    const out = balanceRows(
      [
        row({ outstanding: 500 }),
        row({ supplierId: "s2", supplierType: "in_house", inHouseValue: 900 }),
      ],
      all,
    );
    expect(ids(out)).toEqual(["s1"]);
  });

  it("sorts by outstanding descending, so credit balances sink below settled ones", () => {
    const out = balanceRows(
      [
        row({ supplierId: "settled", outstanding: 0 }),
        row({ supplierId: "credit", outstanding: -989.4 }),
        row({ supplierId: "small", outstanding: 120 }),
        row({ supplierId: "big", outstanding: 18400 }),
      ],
      all,
    );
    expect(ids(out)).toEqual(["big", "small", "settled", "credit"]);
  });

  it("owingOnly keeps real debts and hides both settled and in-credit accounts", () => {
    const out = balanceRows(
      [
        row({ supplierId: "owing", outstanding: 500 }),
        row({ supplierId: "settled", outstanding: 0 }),
        row({ supplierId: "credit", outstanding: -50 }),
      ],
      { search: "", owingOnly: true },
    );
    expect(ids(out)).toEqual(["owing"]);
  });

  it("searches name and code, case-insensitively and ignoring surrounding space", () => {
    const rows = [
      row({ supplierId: "s1", supplierName: "Sharma Flour", supplierCode: "SUP-0001" }),
      row({ supplierId: "s2", supplierName: "Good Milk", supplierCode: "SUP-0002" }),
    ];
    expect(ids(balanceRows(rows, { ...all, search: "  sharma " }))).toEqual(["s1"]);
    expect(ids(balanceRows(rows, { ...all, search: "SUP-0002" }))).toEqual(["s2"]);
    expect(balanceRows(rows, { ...all, search: "nobody" })).toEqual([]);
  });

  it("applies search and owingOnly together", () => {
    const rows = [
      row({ supplierId: "s1", supplierName: "Lab 1", outstanding: -989.4 }),
      row({ supplierId: "s2", supplierName: "Lab 2", outstanding: 300 }),
      row({ supplierId: "s3", supplierName: "Sharma Flour", outstanding: 900 }),
    ];
    expect(ids(balanceRows(rows, { search: "lab", owingOnly: true }))).toEqual(["s2"]);
  });

  it("does not mutate or reorder the caller's array", () => {
    const rows = [row({ supplierId: "a", outstanding: 1 }), row({ supplierId: "b", outstanding: 2 })];
    balanceRows(rows, all);
    expect(ids(rows)).toEqual(["a", "b"]);
  });
});

describe("validateInvoiceDraft", () => {
  const ok = {
    supplierId: "s1",
    supplierType: "external" as const,
    invoiceNo: "INV-77",
    purchaseDate: "2026-07-20",
    lines: [line()],
  };

  it("passes a complete external invoice", () => {
    expect(validateInvoiceDraft(ok, "2026-07-28")).toEqual({});
  });
  it("requires a supplier, a date and at least one line", () => {
    const e = validateInvoiceDraft({ ...ok, supplierId: "", purchaseDate: "", lines: [] }, "2026-07-28");
    expect(e.supplierId).toBeTruthy();
    expect(e.purchaseDate).toBeTruthy();
    expect(e.lines).toBeTruthy();
  });
  it("requires an invoice number from an external supplier only", () => {
    expect(validateInvoiceDraft({ ...ok, invoiceNo: "" }, "2026-07-28").invoiceNo).toBeTruthy();
    expect(
      validateInvoiceDraft(
        { ...ok, supplierType: "in_house", invoiceNo: "" },
        "2026-07-28",
      ).invoiceNo,
    ).toBeUndefined();
  });
  it("refuses an invoice number on an in-house receipt", () => {
    const e = validateInvoiceDraft({ ...ok, supplierType: "in_house" }, "2026-07-28");
    expect(e.invoiceNo).toBeTruthy();
  });
  it("refuses a future purchase date", () => {
    expect(validateInvoiceDraft({ ...ok, purchaseDate: "2026-08-01" }, "2026-07-28").purchaseDate)
      .toBeTruthy();
  });
  it("refuses a line with a non-positive quantity or a negative cost", () => {
    expect(validateInvoiceDraft({ ...ok, lines: [line({ qty: 0 })] }, "2026-07-28").lines).toBeTruthy();
    expect(validateInvoiceDraft({ ...ok, lines: [line({ unitCost: -1 })] }, "2026-07-28").lines)
      .toBeTruthy();
  });
  it("refuses a GST rate on an in-house line", () => {
    const e = validateInvoiceDraft(
      { ...ok, supplierType: "in_house", invoiceNo: "", lines: [line({ gstRate: 5 })] },
      "2026-07-28",
    );
    expect(e.lines).toBeTruthy();
  });
});

describe("isPurchaseMode", () => {
  it("narrows the four settlement modes", () => {
    expect(isPurchaseMode("Bank Transfer")).toBe(true);
    expect(isPurchaseMode("Cheque")).toBe(true);
    expect(isPurchaseMode("Barter")).toBe(false);
  });
});
