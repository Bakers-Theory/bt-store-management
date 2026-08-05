import { describe, expect, it } from "vitest";
import {
  CASHBOOK_REPORT_META,
  CASHBOOK_REPORT_TYPES,
  cashbookReport,
  cashbookReportCsv,
  cashbookReportSheets,
  cashbookReportTables,
  categoryBreakdownTable,
  cashFlowTable,
  dayBookTables,
  discrepancyTable,
  expenseRegisterTable,
  incomeVsExpenseTables,
  monthlyCashTable,
  paymentModeTable,
  vendorBreakdownTable,
  type CashbookReportData,
} from "./cashbook-report";
import { rangeLabel } from "./report";
import type { CashDay, CashEntry, Expense } from "./types";

const shop = { name: "BT", address: "A", phone: "P", currency: "₹" };
const range = { from: "2026-07-01", to: "2026-07-31" };

const entry = (over: Partial<CashEntry> = {}): CashEntry => ({
  id: Math.random().toString(36).slice(2),
  onDate: "2026-07-10",
  createdAt: "2026-07-10T04:00:00.000Z",
  account: "cash",
  direction: "in",
  amount: 100,
  paymentMode: "Cash",
  categoryId: "c1",
  categoryName: "Sales",
  categoryGroup: "",
  categoryPath: "Sales",
  sourceType: "bill",
  sourceId: "b1",
  sourceRef: "#1",
  reversesId: null,
  transferId: null,
  referenceNo: "",
  createdById: "u1",
  createdByName: "Ravi",
  status: "posted",
  note: "",
  runningBalance: 0,
  ...over,
});

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: Math.random().toString(36).slice(2),
  expenseNo: 1,
  expenseDate: "2026-07-10",
  paidOn: "2026-07-10",
  categoryId: "c9",
  categoryName: "Rent",
  categoryGroup: "Utilities",
  categoryPath: "Utilities › Rent",
  vendorName: "Landlord",
  vendorSupplierId: null,
  vendorDisplay: "Landlord",
  amount: 30000,
  gstIncluded: false,
  gstAmount: 0,
  paymentMode: "Bank Transfer",
  splitCash: 0,
  splitBank: 0,
  splitBankMode: "",
  invoiceNo: "",
  description: "",
  paidByName: "Ravi",
  approvedByName: "Owner",
  status: "paid",
  rejectReason: "",
  cancelReason: "",
  createdById: "u1",
  createdByName: "Ravi",
  createdAt: "2026-07-10T04:00:00.000Z",
  updatedByName: "Owner",
  updatedAt: "2026-07-10T05:00:00.000Z",
  stockMovementId: null,
  assetId: null,
  assetMaintenanceId: null,
  originType: "",
  originRef: "",
  ...over,
});

const day = (over: Partial<CashDay> = {}): CashDay => ({
  onDate: "2026-07-10",
  openingCash: 1000,
  expectedCash: 1100,
  countedCash: 1100,
  difference: 0,
  openingBank: null,
  expectedBank: null,
  closingBank: null,
  bankDifference: null,
  remarks: "",
  status: "closed",
  closedByName: "Ravi",
  closedAt: "2026-07-10T15:00:00.000Z",
  reopenedByName: "",
  reopenedAt: null,
  reopenReason: "",
  ...over,
});

const data = (over: Partial<CashbookReportData> = {}): CashbookReportData => ({
  shop,
  entries: [],
  days: [],
  expenses: [],
  openingCash: 0,
  openingBank: 0,
  prevEntries: [],
  cogs: null,
  ...over,
});

describe("metadata", () => {
  it("has an entry for every report type, with unique slugs", () => {
    expect(CASHBOOK_REPORT_TYPES).toHaveLength(9);
    for (const t of CASHBOOK_REPORT_TYPES) {
      expect(CASHBOOK_REPORT_META[t], t).toBeTruthy();
    }
    const slugs = CASHBOOK_REPORT_TYPES.map((t) => CASHBOOK_REPORT_META[t].slug);
    expect(new Set(slugs).size).toBe(9);
  });

  it("does not call report 8 a profit report", () => {
    // Naming it "Profit" for someone who cannot see cost would be a lie.
    expect(CASHBOOK_REPORT_META.incomeVsExpense.name).toBe("Income vs Expense Report");
  });
});

describe("dayBookTables", () => {
  it("chains the opening balance forward from the fetched figure", () => {
    const d = data({
      openingCash: 7200,
      entries: [
        entry({ onDate: "2026-07-10", direction: "in", amount: 450 }),
        entry({ onDate: "2026-07-10", direction: "out", amount: 3000, account: "cash" }),
        entry({ onDate: "2026-07-11", direction: "in", amount: 1000 }),
      ],
    });
    const tables = dayBookTables(d, range);
    // One table per day present, newest first.
    expect(tables).toHaveLength(2);
    expect(tables[0].heading).toContain(ymd("2026-07-11"));
    // 10 Jul: 7200 + 450 − 3000 = 4650. 11 Jul opens there and closes at 5650.
    expect(tables[1].totals?.slice(-1)[0]).toBe(4650);
    expect(tables[0].totals?.slice(-1)[0]).toBe(5650);
  });

  it("reports the counted figure and the difference on a closed day", () => {
    const d = data({
      openingCash: 1000,
      entries: [entry({ onDate: "2026-07-10", direction: "in", amount: 100 })],
      days: [day({ onDate: "2026-07-10", countedCash: 1050, difference: -50 })],
    });
    const flat = JSON.stringify(dayBookTables(d, range));
    expect(flat).toContain("1050");
    expect(flat).toContain("-50");
  });

  it("says so rather than rendering an empty grid when nothing moved", () => {
    const tables = dayBookTables(data(), range);
    expect(tables).toHaveLength(1);
    expect(tables[0].empty).toBeTruthy();
    expect(tables[0].rows).toHaveLength(0);
  });

  it("nets a reversal out instead of hiding it", () => {
    const d = data({
      openingCash: 0,
      entries: [
        entry({ direction: "in", amount: 500 }),
        entry({ direction: "out", amount: 500, reversesId: "x", categoryName: "Sales Reversal" }),
      ],
    });
    // Two visible lines, zero net — a cancelled sale reduces the total rather
    // than vanishing from the record.
    expect(dayBookTables(d, range)[0].rows).toHaveLength(2);
    expect(dayBookTables(d, range)[0].totals?.slice(-1)[0]).toBe(0);
  });
});

describe("monthlyCashTable", () => {
  it("gives one row per day with in, out, net and closing", () => {
    const d = data({
      openingCash: 100,
      entries: [
        entry({ onDate: "2026-07-10", direction: "in", amount: 500 }),
        entry({ onDate: "2026-07-10", direction: "out", amount: 200 }),
        entry({ onDate: "2026-07-12", direction: "in", amount: 50 }),
      ],
    });
    const t = monthlyCashTable(d, range);
    expect(t.rows).toHaveLength(2);
    // 10 Jul: in 500, out 200, net 300, closing 400
    expect(t.rows[0].slice(1)).toEqual([500, 200, 300, 400]);
    // 12 Jul: closing 450
    expect(t.rows[1].slice(-1)[0]).toBe(450);
    expect(t.totals?.slice(1, 4)).toEqual([550, 200, 350]);
  });

  it("counts only cash, not bank", () => {
    const d = data({
      entries: [
        entry({ account: "cash", direction: "in", amount: 100 }),
        entry({ account: "bank", direction: "in", amount: 9000 }),
      ],
    });
    expect(monthlyCashTable(d, range).totals?.[1]).toBe(100);
  });
});

describe("expenseRegisterTable", () => {
  it("lists paid expenses with their vendor and category", () => {
    const t = expenseRegisterTable(data({ expenses: [expense()] }), range);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toContain("Landlord");
    expect(t.rows[0]).toContain("Utilities › Rent");
    expect(t.totals?.slice(-1)[0]).toBe(30000);
  });

  it("excludes rejected and cancelled expenses from the total but still lists them", () => {
    const t = expenseRegisterTable(
      data({
        expenses: [
          expense({ amount: 100, status: "paid" }),
          expense({ amount: 500, status: "rejected", rejectReason: "no receipt" }),
          expense({ amount: 900, status: "cancelled", cancelReason: "wrong vendor" }),
        ],
      }),
      range,
    );
    expect(t.rows).toHaveLength(3);
    // Only money that actually left is totalled.
    expect(t.totals?.slice(-1)[0]).toBe(100);
  });
});

describe("categoryBreakdownTable", () => {
  it("groups by category path with a share of the total", () => {
    const t = categoryBreakdownTable(
      data({
        expenses: [
          expense({ categoryPath: "Utilities › Rent", amount: 30000 }),
          expense({ categoryPath: "Utilities › Rent", amount: 10000 }),
          expense({ categoryPath: "Transport › Fuel", amount: 10000 }),
        ],
      }),
      range,
    );
    expect(t.rows[0][0]).toBe("Utilities › Rent");
    expect(t.rows[0][2]).toBe(40000);
    expect(t.rows[0][3]).toBe("80.0%");
    expect(t.totals?.[2]).toBe(50000);
  });

  it("sorts biggest first, because that is the question being asked", () => {
    const t = categoryBreakdownTable(
      data({
        expenses: [
          expense({ categoryPath: "A", amount: 100 }),
          expense({ categoryPath: "B", amount: 900 }),
        ],
      }),
      range,
    );
    expect(t.rows.map((r) => r[0])).toEqual(["B", "A"]);
  });
});

describe("vendorBreakdownTable", () => {
  it("groups on the vendor display name with a count", () => {
    const t = vendorBreakdownTable(
      data({
        expenses: [
          expense({ vendorDisplay: "Landlord", amount: 30000 }),
          expense({ vendorDisplay: "Landlord", amount: 30000 }),
          expense({ vendorDisplay: "BESCOM", amount: 4000 }),
        ],
      }),
      range,
    );
    expect(t.rows[0]).toEqual(["Landlord", 2, 60000, "93.8%"]);
  });

  it("labels an unnamed vendor rather than showing a blank row", () => {
    const t = vendorBreakdownTable(
      data({ expenses: [expense({ vendorDisplay: "", amount: 50 })] }),
      range,
    );
    expect(t.rows[0][0]).toBe("(no vendor)");
  });
});

describe("paymentModeTable", () => {
  it("splits in and out by mode", () => {
    const t = paymentModeTable(
      data({
        entries: [
          entry({ paymentMode: "Cash", direction: "in", amount: 500 }),
          entry({ paymentMode: "Cash", direction: "out", amount: 200 }),
          entry({ paymentMode: "UPI", account: "bank", direction: "in", amount: 900 }),
        ],
      }),
      range,
    );
    const cash = t.rows.find((r) => r[0] === "Cash");
    // The row is [mode, account, in, out, net].
    expect(cash?.slice(1)).toEqual(["Cash in hand", 500, 200, 300]);
    expect(t.totals?.slice(2)).toEqual([1400, 200, 1200]);
  });
});

describe("cashFlowTable", () => {
  it("reports opening, in, out and closing for both accounts", () => {
    const t = cashFlowTable(
      data({
        openingCash: 1000,
        openingBank: 50000,
        entries: [
          entry({ account: "cash", direction: "in", amount: 500 }),
          entry({ account: "cash", direction: "out", amount: 300 }),
          entry({ account: "bank", direction: "out", amount: 20000 }),
        ],
      }),
      range,
    );
    expect(t.rows[0]).toEqual(["Cash in hand", 1000, 500, 300, 1200]);
    expect(t.rows[1]).toEqual(["Bank", 50000, 0, 20000, 30000]);
    expect(t.totals).toEqual(["Total", 51000, 500, 20300, 31200]);
  });
});

describe("incomeVsExpenseTables", () => {
  it("separates income from expense, nets them, and compares the prior period", () => {
    const d = data({
      entries: [
        entry({ direction: "in", amount: 1000, categoryPath: "Sales" }),
        entry({ direction: "out", amount: 400, categoryPath: "Utilities › Rent" }),
      ],
      prevEntries: [entry({ direction: "in", amount: 800, categoryPath: "Sales" })],
    });
    const tables = incomeVsExpenseTables(d, range);
    const flat = JSON.stringify(tables);
    expect(flat).toContain("Sales");
    expect(flat).toContain("Utilities › Rent");
    // Net movement 600, and Sales up 25% on the prior period.
    expect(flat).toContain("600");
    expect(flat).toContain("25.0%");
  });

  it("omits the gross-profit line when cogs is null", () => {
    const withoutKey = incomeVsExpenseTables(
      data({ entries: [entry({ direction: "in", amount: 1000 })], cogs: null }),
      range,
    );
    expect(JSON.stringify(withoutKey)).not.toContain("Gross profit");
  });

  it("includes the gross-profit line when cogs is present", () => {
    const withKey = incomeVsExpenseTables(
      data({ entries: [entry({ direction: "in", amount: 1000 })], cogs: 400 }),
      range,
    );
    expect(JSON.stringify(withKey)).toContain("Gross profit");
  });

  it("excludes transfers from both sides — moving your own money is not income", () => {
    const d = data({
      entries: [
        entry({ direction: "in", amount: 1000, categoryPath: "Sales" }),
        entry({ direction: "out", amount: 5000, sourceType: "transfer", categoryPath: "Transfer" }),
        entry({
          direction: "in",
          amount: 5000,
          account: "bank",
          sourceType: "transfer",
          categoryPath: "Transfer",
        }),
      ],
    });
    expect(JSON.stringify(incomeVsExpenseTables(d, range))).not.toContain("Transfer");
  });
});

describe("discrepancyTable", () => {
  it("lists only the days that did not tally", () => {
    const t = discrepancyTable(
      data({
        days: [
          day({ onDate: "2026-07-10", difference: 0 }),
          day({ onDate: "2026-07-11", difference: -50, remarks: "short" }),
          day({ onDate: "2026-07-12", difference: 200 }),
        ],
      }),
      range,
    );
    expect(t.rows).toHaveLength(2);
    expect(t.rows.map((r) => r[0])).toEqual([ymd("2026-07-11"), ymd("2026-07-12")]);
  });

  it("totals short and excess separately, then nets them", () => {
    const t = discrepancyTable(
      data({
        days: [
          day({ onDate: "2026-07-11", difference: -450 }),
          day({ onDate: "2026-07-12", difference: 200 }),
        ],
      }),
      range,
    );
    // Netting alone would report −250 and hide that 650 moved unexplained.
    const flat = JSON.stringify(t);
    expect(flat).toContain("-450");
    expect(flat).toContain("200");
    expect(flat).toContain("-250");
  });

  it("says so when every day tallied", () => {
    const t = discrepancyTable(data({ days: [day({ difference: 0 })] }), range);
    expect(t.rows).toHaveLength(0);
    expect(t.empty).toBeTruthy();
  });
});

describe("cashbookReportTables", () => {
  it("dispatches every report type without throwing on empty data", () => {
    for (const t of CASHBOOK_REPORT_TYPES) {
      expect(() => cashbookReportTables(t, data(), range), t).not.toThrow();
      expect(cashbookReportTables(t, data(), range).length, t).toBeGreaterThan(0);
    }
  });
});

describe("cashbookReport (print document)", () => {
  it("carries the shop identity, the period and the report name", () => {
    const r = cashbookReport("cashFlow", data({ openingCash: 100 }), range);
    expect(r.kind).toBe("report");
    expect(r.shop).toBe("BT");
    expect(r.title).toBe("Cash Flow Report");
    expect(r.period).toBe(rangeLabel(range.from, range.to));
    expect(r.tables.length).toBeGreaterThan(0);
  });

  it("summarises the money at the top of a cash-flow document", () => {
    const r = cashbookReport(
      "cashFlow",
      data({ openingCash: 1000, entries: [entry({ direction: "in", amount: 500 })] }),
      range,
    );
    expect(r.summary.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.summary)).toContain("1,500");
  });

  it("gives every report a distinct file name", () => {
    const names = CASHBOOK_REPORT_TYPES.map(
      (t) => cashbookReport(t, data(), range).fileName,
    );
    expect(new Set(names).size).toBe(9);
  });

  it("does not leak a profit figure into the summary without cogs", () => {
    const r = cashbookReport(
      "incomeVsExpense",
      data({ entries: [entry({ direction: "in", amount: 1000 })], cogs: null }),
      range,
    );
    expect(JSON.stringify(r)).not.toContain("Gross profit");
  });
});

describe("cashbookReportSheets", () => {
  it("produces one named sheet per table with a header row of column labels", () => {
    const sheets = cashbookReportSheets("monthlyCash", data(), range);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBeTruthy();
    expect(sheets[0].name.length).toBeLessThanOrEqual(31); // Excel's limit
  });

  it("splits a multi-table report across sheets", () => {
    const sheets = cashbookReportSheets(
      "incomeVsExpense",
      data({ entries: [entry({ direction: "in", amount: 10 })] }),
      range,
    );
    // Income, Expense, Summary.
    expect(sheets.length).toBe(3);
  });

  it("keeps every sheet name inside Excel's 31-character limit", () => {
    for (const t of CASHBOOK_REPORT_TYPES) {
      for (const s of cashbookReportSheets(t, data(), range)) {
        expect(s.name.length, `${t}/${s.name}`).toBeLessThanOrEqual(31);
      }
    }
  });
});

describe("cashbookReportCsv", () => {
  it("emits a header row followed by the data rows", () => {
    const csv = cashbookReportCsv(
      "monthlyCash",
      data({
        openingCash: 100,
        entries: [entry({ onDate: "2026-07-10", direction: "in", amount: 500 })],
      }),
      range,
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Cash in");
    expect(lines.some((l) => l.includes("500"))).toBe(true);
  });

  it("quotes a value containing a comma so the columns survive", () => {
    const csv = cashbookReportCsv(
      "vendorBreakdown",
      data({ expenses: [expense({ vendorDisplay: "Smith, Jones & Co" })] }),
      range,
    );
    expect(csv).toContain('"Smith, Jones & Co"');
  });
});

/** Matches whatever `ymdToDMY` produces, so the tests don't pin its format. */
function ymd(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}-${m}-${y}`;
}
