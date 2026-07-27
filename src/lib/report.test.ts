import { describe, it, expect } from "vitest";
import {
  attendanceReport,
  padTotals,
  payrollReport,
  rangeLabel,
  salaryHistoryReport,
} from "./report";
import type {
  Attendance,
  AttendanceSummary,
  PayrollRow,
  SalaryPayment,
} from "./types";
import type { ShopInfo as Shop } from "./report";

const shop: Shop = {
  name: "Bakers Theory",
  address: "12 Main Road",
  phone: "9876543210",
  currency: "₹",
};

const sum = (name: string, p: Partial<AttendanceSummary> = {}): AttendanceSummary => ({
  profileId: name, employeeName: name,
  present: 0, halfDay: 0, leave: 0, holiday: 0,
  recorded: 0, payableDays: 0, unpaidDays: 0, ...p,
});

const rec = (p: Partial<Attendance> = {}): Attendance => ({
  id: "1", profileId: "a", employeeName: "Anjali", date: "2026-07-03",
  status: "leave", note: "", markedByName: "Admin",
  updatedAt: "2026-07-03T00:00:00Z", ...p,
});

const payroll = (p: Partial<PayrollRow> = {}): PayrollRow => ({
  profileId: "a", employeeName: "Anjali", gross: 18000, calendarDays: 31,
  recorded: 31, unpaidDays: 2.5, deduction: 1451.61, computedNet: 16548.39,
  paymentId: null, status: "none", net: null, storedComputedNet: null,
  overrideReason: "", paidOn: null, paymentMode: "",
  advanceBalance: 0, advanceRecovery: 0, netPayable: 16548.39, ...p,
});

const payment = (p: Partial<SalaryPayment> = {}): SalaryPayment => ({
  id: "p1", profileId: "a", employeeName: "Anjali",
  periodYear: 2026, periodMonth: 7, gross: 18000, calendarDays: 31,
  recordedDays: 31, unpaidDays: 2.5, deduction: 1451.61, computedNet: 16548.39, net: 16548.39,
  overrideReason: "", status: "paid", paidOn: "2026-08-01", paymentMode: "UPI",
  recordedByName: "Admin", updatedAt: "2026-08-01T00:00:00Z",
  advanceRecovery: 0, netPayable: 16548.39, ...p,
});

describe("rangeLabel", () => {
  it("formats a bounded range readably", () => {
    expect(rangeLabel("2026-07-01", "2026-07-31")).toBe("1 Jul 2026 – 31 Jul 2026");
  });
  it("collapses a single day", () => {
    expect(rangeLabel("2026-07-01", "2026-07-01")).toBe("1 Jul 2026");
  });
  it("handles open ends and no range at all", () => {
    expect(rangeLabel("2026-07-01", null)).toBe("From 1 Jul 2026");
    expect(rangeLabel(null, "2026-07-31")).toBe("Up to 31 Jul 2026");
    expect(rangeLabel(null, null)).toBe("All time");
  });
});

describe("padTotals", () => {
  it("pads a short totals row to the column count", () => {
    expect(padTotals(["Total", 5], 4)).toEqual(["Total", 5, "", ""]);
  });
  it("leaves an already-full row alone", () => {
    expect(padTotals(["a", "b"], 2)).toEqual(["a", "b"]);
  });
  it("never truncates a longer row", () => {
    expect(padTotals(["a", "b", "c"], 2)).toEqual(["a", "b", "c"]);
  });
});

describe("attendanceReport", () => {
  const report = attendanceReport(
    shop,
    [sum("Anjali", { present: 24, halfDay: 1, leave: 2, holiday: 4, recorded: 31, unpaidDays: 2.5 })],
    [rec({ note: "fever" })],
    "2026-07-01",
    "2026-07-31",
    null,
  );

  it("carries the shop identity and period", () => {
    expect(report.shop).toBe("Bakers Theory");
    expect(report.shopMeta).toBe("12 Main Road · 9876543210");
    expect(report.period).toBe("1 Jul 2026 – 31 Jul 2026");
    expect(report.scope).toBe("All employees");
  });

  it("has a per-employee table whose totals row matches the column count", () => {
    const t = report.tables[0];
    expect(t.heading).toBe("Per employee");
    expect(t.rows[0][0]).toBe("Anjali");
    expect(t.totals).toBeDefined();
    expect(padTotals(t.totals!, t.columns.length)).toHaveLength(t.columns.length);
  });

  it("every table row matches its own column count", () => {
    for (const t of report.tables) {
      for (const row of t.rows) {
        expect(row, t.heading).toHaveLength(t.columns.length);
      }
    }
  });

  it("includes the note text in the detail table", () => {
    const detail = report.tables[1];
    expect(detail.rows[0]).toContain("fever");
    expect(detail.rows[0]).toContain("Leave");
  });

  it("names a single employee as the scope when filtered", () => {
    const one = attendanceReport(shop, [], [], null, null, "Anjali");
    expect(one.scope).toBe("Anjali");
  });

  it("gives every table empty text, so a filtered-to-nothing PDF isn't blank", () => {
    const none = attendanceReport(shop, [], [], null, null, null);
    for (const t of none.tables) {
      expect(t.rows).toHaveLength(0);
      expect(t.empty, t.heading).toBeTruthy();
    }
  });

  it("explains the pay rules in the footnote", () => {
    expect(report.note).toMatch(/Leave is unpaid/);
    expect(report.note).toMatch(/no record are excluded/);
  });
});

describe("payrollReport", () => {
  const report = payrollReport(
    shop,
    [
      payroll({ status: "paid", net: 16548.39, paidOn: "2026-08-01", paymentMode: "UPI" }),
      payroll({ profileId: "b", employeeName: "Ravi", gross: 12000, unpaidDays: 0,
                deduction: 0, computedNet: 12000 }),
      // No salary — must be excluded from the payroll document entirely.
      payroll({ profileId: "c", employeeName: "Nobody", gross: 0, deduction: 0, computedNet: 0 }),
    ],
    2026, 7,
  );

  it("titles the period in words", () => {
    expect(report.title).toBe("Salary report");
    expect(report.period).toBe("July 2026");
  });

  it("excludes employees with no salary, and says how many are on payroll", () => {
    expect(report.tables[0].rows).toHaveLength(2);
    expect(report.tables[0].rows.map((r) => r[0])).not.toContain("Nobody");
    expect(report.scope).toBe("2 employees on payroll");
  });

  it("summarises gross, deductions and net in currency", () => {
    const byLabel = Object.fromEntries(report.summary.map((s) => [s.label, s.value]));
    expect(byLabel.Gross).toBe("₹30000.00");
    expect(byLabel.Deductions).toBe("₹1451.61");
    expect(byLabel["Net payable"]).toBe("₹28548.39");
    expect(byLabel.Paid).toBe("1 of 2");
  });

  it("shows recorded/calendar days and a signed deduction", () => {
    const row = report.tables[0].rows[0];
    expect(row[2]).toBe("31/31");
    expect(row[4]).toBe("−₹1451.61");
  });

  it("renders an unprepared period as 'Not prepared', not as blank or paid", () => {
    const row = report.tables[0].rows[1];
    expect(row[6]).toBe("Not prepared");
    expect(row[7]).toBe("—");
  });

  it("has a totals row aligned to the columns", () => {
    const t = report.tables[0];
    expect(padTotals(t.totals!, t.columns.length)).toHaveLength(t.columns.length);
  });

  it("names the file by period so saved PDFs sort", () => {
    expect(report.fileName).toBe("bakers-theory-salary-2026-07");
  });

  it("stays valid with nobody on the payroll", () => {
    const none = payrollReport(shop, [], 2026, 2);
    expect(none.tables[0].rows).toHaveLength(0);
    expect(none.tables[0].empty).toBeTruthy();
    expect(none.summary.length).toBeGreaterThan(0);
  });
});

describe("salaryHistoryReport", () => {
  const report = salaryHistoryReport(
    shop,
    [
      payment(),
      payment({ id: "p2", periodMonth: 6, status: "unpaid", net: 17000, paidOn: null, paymentMode: "" }),
    ],
    null,
  );

  it("spans oldest to newest period", () => {
    // Rows arrive newest-first, so the label reads June → July.
    expect(report.period).toBe("June 2026 – July 2026");
  });

  it("separates paid from outstanding", () => {
    const byLabel = Object.fromEntries(report.summary.map((s) => [s.label, s.value]));
    expect(byLabel.Paid).toBe("₹16548.39");
    expect(byLabel.Outstanding).toBe("₹17000.00");
    expect(byLabel.Records).toBe("2");
  });

  it("totals only the paid rows", () => {
    expect(report.tables[0].totals).toContain("₹16548.39");
  });

  it("dashes an unpaid row's date and mode rather than leaving gaps", () => {
    const unpaid = report.tables[0].rows[1];
    expect(unpaid[6]).toBe("—");
    expect(unpaid[7]).toBe("—");
  });

  it("says 'No records' rather than an empty period when there are none", () => {
    const none = salaryHistoryReport(shop, [], null);
    expect(none.period).toBe("No records");
    expect(none.tables[0].empty).toBeTruthy();
  });
});
