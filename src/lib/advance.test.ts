import { describe, it, expect } from "vitest";
import {
  ADVANCE_REPORT_HEADER,
  advanceBalance,
  advanceHeadroom,
  advanceReportRows,
  advanceTotals,
  canRequestAdvance,
  isRecoveryValid,
  openBalances,
  recoveryCeiling,
} from "./advance";
import type { AdvanceBalance } from "./types";

const bal = (p: Partial<AdvanceBalance> = {}): AdvanceBalance => ({
  profileId: "a",
  employeeName: "Anjali",
  totalAdvanced: 15000,
  totalRecovered: 3000,
  balance: 12000,
  pendingAmount: 0,
  oldestOpen: "2026-06-10",
  monthlySalary: 20000,
  ...p,
});

describe("advanceBalance", () => {
  it("is advanced minus recovered", () => {
    expect(advanceBalance(15000, 3000)).toBe(12000);
  });

  it("rounds to paise rather than leaving a float artefact", () => {
    expect(advanceBalance(0.3, 0.1)).toBe(0.2);
  });

  it("never reports a negative balance", () => {
    expect(advanceBalance(1000, 1500)).toBe(0);
  });
});

describe("advanceHeadroom", () => {
  it("is the salary less the balance and anything pending", () => {
    expect(advanceHeadroom(12000, 2000, 20000)).toBe(6000);
  });

  it("is zero, not negative, when already at or over the cap", () => {
    expect(advanceHeadroom(20000, 5000, 20000)).toBe(0);
  });

  it("is zero when no salary is set", () => {
    expect(advanceHeadroom(0, 0, 0)).toBe(0);
  });
});

describe("canRequestAdvance", () => {
  it("allows an amount exactly at the cap", () => {
    expect(canRequestAdvance(12000, 0, 20000, 8000).ok).toBe(true);
  });

  it("refuses one paisa over the cap", () => {
    const r = canRequestAdvance(12000, 0, 20000, 8000.01);
    expect(r.ok).toBe(false);
    // Loose on wording, strict on the fact: the message must name the cap.
    // Do NOT tighten this to an exact string — it would drive the copy.
    expect(r.reason).toMatch(/month.s salary/i);
  });

  // The reason pending is counted: two requests that each pass on their own
  // must not be able to breach the cap together.
  it("counts pending requests toward the cap", () => {
    expect(canRequestAdvance(0, 15000, 20000, 8000).ok).toBe(false);
  });

  it("refuses any advance when no salary is set", () => {
    const r = canRequestAdvance(0, 0, 0, 100);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("salary");
  });

  it("refuses a zero or negative amount", () => {
    expect(canRequestAdvance(0, 0, 20000, 0).ok).toBe(false);
    expect(canRequestAdvance(0, 0, 20000, -500).ok).toBe(false);
  });
});

describe("recoveryCeiling", () => {
  it("is the balance when the balance is below the net", () => {
    expect(recoveryCeiling(3000, 0, 18000)).toBe(3000);
  });

  it("is the net when the balance exceeds it, so net never goes negative", () => {
    expect(recoveryCeiling(50000, 0, 18000)).toBe(18000);
  });

  // The edit-in-place case. The record's own recovery is already subtracted
  // inside the balance, so it has to be added back — otherwise lowering a
  // recovery is impossible and raising one is off by the old amount.
  it("adds back this record's existing recovery", () => {
    // balance 0 because all 3000 is already recovered on this very record.
    expect(recoveryCeiling(0, 3000, 18000)).toBe(3000);
  });
});

describe("isRecoveryValid", () => {
  it("accepts lowering an existing recovery", () => {
    expect(isRecoveryValid(1000, 0, 3000, 18000)).toBe(true);
  });

  it("accepts raising it back to its original value", () => {
    expect(isRecoveryValid(3000, 0, 3000, 18000)).toBe(true);
  });

  it("refuses one paisa above the ceiling", () => {
    expect(isRecoveryValid(3000.01, 0, 3000, 18000)).toBe(false);
  });

  it("accepts zero", () => {
    expect(isRecoveryValid(0, 5000, 0, 18000)).toBe(true);
  });

  it("refuses a negative recovery", () => {
    expect(isRecoveryValid(-1, 5000, 0, 18000)).toBe(false);
  });
});

// recoveryCeiling doubles as the pre-filled default, so these cases pin that
// behaviour on the same function rather than on a second alias of it.
describe("recoveryCeiling as the pre-filled default", () => {
  // Decision 10 is enforced UPSTREAM, in advance_balance_of: a prepared-but-
  // unpaid recovery is already subtracted from `balance` before it reaches this
  // function. So this unit cannot pin that property — it can only show that
  // whatever balance it is handed is offered in full when the net allows. Named
  // honestly rather than claiming to verify decision 10.
  it("offers the whole balance it is given when the net covers it", () => {
    expect(recoveryCeiling(12000, 0, 18000)).toBe(12000);
  });

  it("keeps showing an existing recovery rather than collapsing to zero", () => {
    expect(recoveryCeiling(0, 3000, 18000)).toBe(3000);
  });
});

describe("openBalances", () => {
  it("keeps only employees who still owe something", () => {
    const rows = [bal(), bal({ profileId: "b", employeeName: "Ravi", balance: 0 })];
    expect(openBalances(rows).map((r) => r.employeeName)).toEqual(["Anjali"]);
  });
});

describe("advanceTotals", () => {
  it("counts only employees with an open balance", () => {
    const rows = [
      bal(),
      bal({ profileId: "b", employeeName: "Ravi", balance: 0, totalAdvanced: 5000, totalRecovered: 5000 }),
    ];
    const t = advanceTotals(rows);
    expect(t.employees).toBe(1);
    expect(t.outstanding).toBe(12000);
  });

  it("sums advanced and recovered across everyone, open or not", () => {
    const rows = [
      bal(),
      bal({ profileId: "b", balance: 0, totalAdvanced: 5000, totalRecovered: 5000 }),
    ];
    const t = advanceTotals(rows);
    expect(t.advanced).toBe(20000);
    expect(t.recovered).toBe(8000);
  });
});

describe("advanceReportRows", () => {
  it("excludes zero balances and orders by name", () => {
    const rows = [
      bal({ profileId: "b", employeeName: "Ravi" }),
      bal({ profileId: "c", employeeName: "Anjali" }),
      bal({ profileId: "d", employeeName: "Zoya", balance: 0 }),
    ];
    expect(advanceReportRows(rows).map((r) => r[0])).toEqual(["Anjali", "Ravi"]);
  });

  it("produces a row matching the header width", () => {
    expect(advanceReportRows([bal()])[0]).toHaveLength(ADVANCE_REPORT_HEADER.length);
  });

  it("renders a missing oldest-open date as an empty cell, not 'null'", () => {
    const r = advanceReportRows([bal({ oldestOpen: null })])[0];
    expect(r).not.toContain(null);
    expect(r[r.length - 1]).toBe("");
  });
});
