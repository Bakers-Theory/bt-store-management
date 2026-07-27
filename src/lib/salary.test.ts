import { describe, it, expect } from "vitest";
import {
  PAYROLL_REPORT_HEADER,
  SALARY_MODES,
  calendarDays,
  computePay,
  isAdjusted,
  isSalaryMode,
  isStale,
  missingDays,
  payrollReportRows,
  payrollTotals,
  periodLabel,
  periodSlug,
  round2,
  withGaps,
} from "./salary";
import { STATUS_META, unpaidDays } from "./attendance";
import type { AttendanceStatus, PayrollRow } from "./types";

const row = (p: Partial<PayrollRow> = {}): PayrollRow => ({
  profileId: "a",
  employeeName: "Anjali",
  gross: 18000,
  calendarDays: 31,
  recorded: 31,
  unpaidDays: 0,
  deduction: 0,
  computedNet: 18000,
  paymentId: null,
  status: "none",
  net: null,
  storedComputedNet: null,
  overrideReason: "",
  paidOn: null,
  paymentMode: "",
  advanceBalance: 0,
  advanceRecovery: 0,
  netPayable: 18000,
  ...p,
});

const counts = (p: Partial<Record<AttendanceStatus, number>>) => ({
  present: 0, half_day: 0, leave: 0, holiday: 0, ...p,
});

describe("calendarDays", () => {
  it("returns the real length of each month", () => {
    expect(calendarDays(2026, 1)).toBe(31);
    expect(calendarDays(2026, 4)).toBe(30);
    expect(calendarDays(2026, 7)).toBe(31);
    expect(calendarDays(2026, 12)).toBe(31);
  });
  it("handles February in common and leap years", () => {
    expect(calendarDays(2026, 2)).toBe(28);
    expect(calendarDays(2028, 2)).toBe(29);
    // Century rules: 1900 is not a leap year, 2000 is.
    expect(calendarDays(1900, 2)).toBe(28);
    expect(calendarDays(2000, 2)).toBe(29);
  });
});

describe("unpaid-day weights", () => {
  it("charges Leave a whole day and Half Day a half; Present/Holiday nothing", () => {
    expect(unpaidDays(counts({ leave: 2 }))).toBe(2);
    expect(unpaidDays(counts({ half_day: 3 }))).toBe(1.5);
    expect(unpaidDays(counts({ present: 20, holiday: 4 }))).toBe(0);
  });
  it("is not simply 1 − payable weight, because unrecorded days differ", () => {
    // A recorded Leave costs a day; a day with no record costs nothing. If the
    // two weights were derived from each other that distinction would collapse.
    expect(STATUS_META.leave.weight).toBe(0);
    expect(STATUS_META.leave.unpaidWeight).toBe(1);
    expect(STATUS_META.present.weight).toBe(1);
    expect(STATUS_META.present.unpaidWeight).toBe(0);
  });
  it("charges nothing for a month with no records at all", () => {
    // An unmarked month is incomplete data, not 30 days of unpaid leave.
    expect(unpaidDays(counts({}))).toBe(0);
  });
});

describe("computePay", () => {
  it("matches the agreed worked example", () => {
    // ₹18,000 in July: 24 present, 4 holiday, 2 leave, 1 half day.
    const unpaid = unpaidDays(counts({ present: 24, holiday: 4, leave: 2, half_day: 1 }));
    expect(unpaid).toBe(2.5);
    const { deduction, net } = computePay(18000, 31, unpaid);
    expect(deduction).toBe(1451.61);
    expect(net).toBe(16548.39);
  });

  it("pays the full salary when nothing is deductible", () => {
    expect(computePay(18000, 31, 0).net).toBe(18000);
  });

  it("keeps gross − deduction === net exactly, so a payslip always adds up", () => {
    // A third-of-a-rupee per-day rate is the classic place this breaks.
    for (const [gross, days, unpaid] of [
      [10000, 31, 1], [18000, 28, 2.5], [25000, 30, 0.5],
      [33333, 31, 7], [1, 31, 1], [99999.99, 29, 3.5],
    ] as const) {
      const { deduction, net } = computePay(gross, days, unpaid);
      expect(round2(gross - deduction), `${gross}/${days}/${unpaid}`).toBe(net);
    }
  });

  it("never deducts more than the salary, however much leave was taken", () => {
    // 40 unpaid days in a 31-day month can only ever zero the pay.
    const { deduction, net } = computePay(18000, 31, 40);
    expect(net).toBe(0);
    expect(deduction).toBe(18000);
  });

  it("charges a shorter month a higher per-day rate", () => {
    // The direct consequence of a calendar-day divisor: one leave day in
    // February costs more than one in July.
    const feb = computePay(18000, 28, 1).deduction;
    const jul = computePay(18000, 31, 1).deduction;
    expect(feb).toBeGreaterThan(jul);
    expect(feb).toBe(642.86);
    expect(jul).toBe(580.65);
  });

  it("degrades safely on a zero divisor instead of returning NaN", () => {
    expect(computePay(18000, 0, 3).net).toBe(18000);
    expect(computePay(18000, 0, 3).deduction).toBe(0);
  });

  it("treats a zero salary as nothing owed", () => {
    expect(computePay(0, 31, 5)).toEqual({ perDay: 0, deduction: 0, net: 0 });
  });
});

describe("round2", () => {
  it("rounds to paise without float artefacts", () => {
    expect(round2(1.005)).toBe(1.01); // naive Math.round gives 1.00
    expect(round2(580.6451612903226)).toBe(580.65);
    expect(round2(0)).toBe(0);
  });
});

describe("missingDays / withGaps", () => {
  it("counts unrecorded days in the month", () => {
    expect(missingDays(row({ calendarDays: 31, recorded: 24 }))).toBe(7);
    expect(missingDays(row({ calendarDays: 31, recorded: 31 }))).toBe(0);
  });
  it("never goes negative if more rows exist than days", () => {
    expect(missingDays(row({ calendarDays: 28, recorded: 31 }))).toBe(0);
  });
  it("flags only employees on the payroll with an incomplete month", () => {
    const rows = [
      row({ profileId: "full", recorded: 31 }),
      row({ profileId: "gap", recorded: 20 }),
      // No salary set: not on the payroll, so not a payroll warning.
      row({ profileId: "nosalary", gross: 0, recorded: 5 }),
    ];
    expect(withGaps(rows).map((r) => r.profileId)).toEqual(["gap"]);
  });
});

describe("isAdjusted / isStale", () => {
  it("are both false before a record exists", () => {
    const r = row({ net: null, storedComputedNet: null });
    expect(isAdjusted(r)).toBe(false);
    expect(isStale(r)).toBe(false);
  });

  it("are both false for an untouched record matching live attendance", () => {
    const r = row({ computedNet: 16548.39, storedComputedNet: 16548.39, net: 16548.39 });
    expect(isAdjusted(r)).toBe(false);
    expect(isStale(r)).toBe(false);
  });

  it("reports a manual adjustment, not staleness", () => {
    // Filed 17000 against a calculation that said 16548.39, attendance unchanged.
    const r = row({
      computedNet: 16548.39, storedComputedNet: 16548.39,
      net: 17000, overrideReason: "festival bonus",
    });
    expect(isAdjusted(r)).toBe(true);
    expect(isStale(r)).toBe(false);
  });

  it("reports staleness, NOT an adjustment, when attendance moved afterwards", () => {
    // This is the bug the stored figure exists to prevent: a leave day added
    // after preparing must not read as though someone overrode the net.
    const r = row({
      computedNet: 15967.74,      // recomputed now — one more leave day
      storedComputedNet: 16548.39, // what it said when prepared
      net: 16548.39,               // filed, untouched
    });
    expect(isAdjusted(r)).toBe(false);
    expect(isStale(r)).toBe(true);
  });

  it("can report both at once", () => {
    const r = row({
      computedNet: 15967.74, storedComputedNet: 16548.39,
      net: 17000, overrideReason: "advance settled",
    });
    expect(isAdjusted(r)).toBe(true);
    expect(isStale(r)).toBe(true);
  });

  it("ignores float noise rather than reporting a phantom change", () => {
    expect(isAdjusted(row({ storedComputedNet: 16548.39, net: 16548.390000001 }))).toBe(false);
    expect(isStale(row({ storedComputedNet: 16548.39, computedNet: 16548.390000001 }))).toBe(false);
  });
});

describe("payrollTotals", () => {
  it("excludes employees with no salary set", () => {
    const t = payrollTotals([
      row({ gross: 18000, computedNet: 18000 }),
      row({ profileId: "b", gross: 0, computedNet: 0 }),
    ]);
    expect(t.employees).toBe(1);
    expect(t.gross).toBe(18000);
  });
  it("uses the filed net where one exists and the computed net otherwise", () => {
    const t = payrollTotals([
      row({ computedNet: 16548.39, storedComputedNet: 16548.39, net: 17000, status: "paid" }),
      row({ profileId: "b", computedNet: 18000, net: null, status: "none" }),
    ]);
    expect(t.net).toBe(35000);
  });
  it("counts each status separately", () => {
    const t = payrollTotals([
      row({ profileId: "a", status: "paid", net: 100 }),
      row({ profileId: "b", status: "unpaid", net: 100 }),
      row({ profileId: "c", status: "none" }),
      row({ profileId: "d", status: "none" }),
    ]);
    expect([t.paid, t.unpaid, t.notCreated]).toEqual([1, 1, 2]);
  });
  it("is all zeros for an empty payroll", () => {
    expect(payrollTotals([]).employees).toBe(0);
    expect(payrollTotals([]).net).toBe(0);
  });
});

describe("payrollTotals with advances", () => {
  it("is unchanged when nobody has a recovery", () => {
    const rows = [row({ net: 18000, netPayable: 18000 })];
    const t = payrollTotals(rows);
    expect(t.net).toBe(18000);
    expect(t.advanceRecovery).toBe(0);
    // With no recovery, the payable is the net — the existing behaviour.
    expect(t.netPayable).toBe(18000);
  });

  it("sums recoveries and reports the payable separately from the net", () => {
    const rows = [
      row({ net: 18000, advanceRecovery: 3000, netPayable: 15000 }),
      row({ profileId: "b", net: 12000, advanceRecovery: 1000, netPayable: 11000 }),
    ];
    const t = payrollTotals(rows);
    // `net` keeps its meaning: salary net of leave, before any recovery.
    expect(t.net).toBe(30000);
    expect(t.advanceRecovery).toBe(4000);
    expect(t.netPayable).toBe(26000);
  });

  it("ignores employees with no salary set, as it already does for net", () => {
    const rows = [row({ gross: 0, net: 0, advanceRecovery: 500, netPayable: 0 })];
    expect(payrollTotals(rows).advanceRecovery).toBe(0);
  });
});

describe("period helpers", () => {
  it("labels and slugs a period", () => {
    expect(periodLabel(2026, 7)).toBe("July 2026");
    expect(periodSlug(2026, 7)).toBe("2026-07");
    expect(periodSlug(2026, 12)).toBe("2026-12");
  });
});

describe("payment modes", () => {
  it("offers the four modes and rejects anything else", () => {
    expect(SALARY_MODES).toEqual(["Cash", "UPI"]);
    expect(isSalaryMode("Cash")).toBe(true);
    expect(isSalaryMode("Crypto")).toBe(false);
    expect(isSalaryMode("")).toBe(false);
  });
});

describe("payrollReportRows", () => {
  it("emits one row per employee on the payroll, matching the header width", () => {
    const rows = payrollReportRows(
      [
        row({ recorded: 24, unpaidDays: 2.5, deduction: 1451.61, computedNet: 16548.39,
              storedComputedNet: 16548.39, net: 16548.39, status: "paid",
              paidOn: "2026-08-01", paymentMode: "UPI" }),
        row({ profileId: "b", gross: 0 }), // no salary — excluded
      ],
      2026, 7,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(PAYROLL_REPORT_HEADER.length);
    expect(rows[0][0]).toBe("2026-07");
    expect(rows[0][5]).toBe(7); // 31 calendar − 24 recorded
    expect(rows[0][10]).toBe("paid");
  });
  it("renders a period with no record as 'not created' rather than blank", () => {
    const rows = payrollReportRows([row({ status: "none", net: null })], 2026, 7);
    expect(rows[0][9]).toBe("");
    expect(rows[0][10]).toBe("not created");
  });
});
