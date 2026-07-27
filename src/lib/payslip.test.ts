import { describe, it, expect } from "vitest";
import {
  amountInWords,
  numberToWords,
  payslipFromPayment,
  payslipFromPayroll,
} from "./payslip";
import type { ShopInfo } from "./report";
import type { PayrollRow, SalaryPayment } from "./types";

const shop: ShopInfo = {
  name: "Bakers Theory", address: "12 Main Road", phone: "9876543210", currency: "₹",
};

const row = (p: Partial<PayrollRow> = {}): PayrollRow => ({
  profileId: "a", employeeName: "Anjali", gross: 18000, calendarDays: 31,
  recorded: 31, unpaidDays: 2.5, deduction: 1451.61, computedNet: 16548.39,
  paymentId: null, status: "none", net: null, storedComputedNet: null,
  overrideReason: "", paidOn: null, paymentMode: "",
  advanceBalance: 0, advanceRecovery: 0, netPayable: 16548.39, ...p,
});

const payment = (p: Partial<SalaryPayment> = {}): SalaryPayment => ({
  id: "p1", profileId: "a", employeeName: "Anjali", periodYear: 2026,
  periodMonth: 7, gross: 18000, calendarDays: 31, recordedDays: 31,
  unpaidDays: 2.5, deduction: 1451.61, computedNet: 16548.39, net: 16548.39,
  overrideReason: "", status: "paid", paidOn: "2026-08-01", paymentMode: "UPI",
  recordedByName: "Admin", updatedAt: "2026-08-01T00:00:00Z",
  advanceRecovery: 0, netPayable: 16548.39, ...p,
});

describe("numberToWords (Indian system)", () => {
  it("handles the small cases", () => {
    expect(numberToWords(0)).toBe("Zero");
    expect(numberToWords(7)).toBe("Seven");
    expect(numberToWords(15)).toBe("Fifteen");
    expect(numberToWords(20)).toBe("Twenty");
    expect(numberToWords(21)).toBe("Twenty One");
    expect(numberToWords(100)).toBe("One Hundred");
    expect(numberToWords(101)).toBe("One Hundred One");
  });
  it("groups by thousand, lakh and crore — not million", () => {
    expect(numberToWords(1000)).toBe("One Thousand");
    expect(numberToWords(18000)).toBe("Eighteen Thousand");
    expect(numberToWords(100000)).toBe("One Lakh");
    expect(numberToWords(250000)).toBe("Two Lakh Fifty Thousand");
    expect(numberToWords(10000000)).toBe("One Crore");
    expect(numberToWords(12345678)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight",
    );
  });
  it("skips empty groups rather than emitting 'Zero Thousand'", () => {
    expect(numberToWords(100001)).toBe("One Lakh One");
    expect(numberToWords(1000000)).toBe("Ten Lakh");
  });
  it("refuses nonsense instead of producing garbage", () => {
    expect(numberToWords(-5)).toBe("");
    expect(numberToWords(NaN)).toBe("");
  });
});

describe("amountInWords", () => {
  it("writes the worked example the way a payslip reads", () => {
    expect(amountInWords(16548.39)).toBe(
      "Sixteen Thousand Five Hundred Forty Eight Rupees and Thirty Nine Paise Only",
    );
  });
  it("omits paise when there are none", () => {
    expect(amountInWords(18000)).toBe("Eighteen Thousand Rupees Only");
  });
  it("singularises one rupee", () => {
    expect(amountInWords(1)).toBe("One Rupee Only");
  });
  it("handles zero pay", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
  });
  it("derives paise from the rounded figure, not the raw float", () => {
    // 0.1+0.2 style drift must not become "Twenty Nine Paise".
    expect(amountInWords(100.305)).toContain("Thirty One Paise");
    expect(amountInWords(999.999)).toBe("One Thousand Rupees Only");
  });
});

describe("payslipFromPayroll", () => {
  it("shows salary, deduction and net, with the deduction explained", () => {
    const slip = payslipFromPayroll(shop, row(), 2026, 7);
    expect(slip.kind).toBe("payslip");
    expect(slip.employeeName).toBe("Anjali");
    expect(slip.period).toBe("July 2026");
    expect(slip.lines[0]).toMatchObject({ label: "Monthly salary", value: "₹18000.00" });
    // The label states the arithmetic so the figure can be checked by hand.
    expect(slip.lines[1].label).toBe("Unpaid days (2.5 × ₹580.65)");
    expect(slip.lines[1].minus).toBe(true);
    expect(slip.lines.at(-1)).toMatchObject({ label: "Net pay", strong: true });
  });

  it("omits the deduction line entirely when nothing is deducted", () => {
    const slip = payslipFromPayroll(
      shop, row({ unpaidDays: 0, deduction: 0, computedNet: 18000 }), 2026, 7,
    );
    expect(slip.lines.map((l) => l.label)).toEqual(["Monthly salary", "Net pay"]);
    expect(slip.net).toBe("₹18000.00");
  });

  it("shows an adjustment as its own line, with the reason", () => {
    const slip = payslipFromPayroll(
      shop,
      row({ paymentId: "x", status: "unpaid", net: 17000,
            storedComputedNet: 16548.39, overrideReason: "festival bonus" }),
      2026, 7,
    );
    const adj = slip.lines.find((l) => l.label.startsWith("Adjustment"));
    expect(adj?.label).toContain("festival bonus");
    expect(adj?.minus).toBe(false); // paid more, not less
  });

  it("states the payment status", () => {
    expect(payslipFromPayroll(shop, row({ status: "none" }), 2026, 7).statusLine)
      .toBe("Payroll not yet prepared");
    expect(payslipFromPayroll(shop, row({ paymentId: "x", status: "unpaid" }), 2026, 7).statusLine)
      .toBe("Payment pending");
    expect(
      payslipFromPayroll(
        shop,
        row({ paymentId: "x", status: "paid", paidOn: "2026-08-01", paymentMode: "UPI" }),
        2026, 7,
      ).statusLine,
    ).toBe("Paid on 2026-08-01 by UPI");
  });

  it("names the file by employee and period", () => {
    expect(payslipFromPayroll(shop, row(), 2026, 7).fileName)
      .toBe("bakers-theory-payslip-anjali-2026-07");
  });

  it("spells the net out in words", () => {
    const slip = payslipFromPayroll(shop, row({ paymentId: "x", net: 16548.39, storedComputedNet: 16548.39 }), 2026, 7);
    expect(slip.netInWords).toContain("Sixteen Thousand Five Hundred Forty Eight Rupees");
  });
});

describe("payslipFromPayment", () => {
  it("reprints a filed month from its own snapshot", () => {
    const slip = payslipFromPayment(shop, payment());
    expect(slip.period).toBe("July 2026");
    expect(slip.net).toBe("₹16548.39");
    expect(slip.statusLine).toBe("Paid on 2026-08-01 by UPI");
  });

  it("omits days-recorded rather than inventing it for older records", () => {
    // recorded_days was added after the table shipped, so old rows carry null.
    const slip = payslipFromPayment(shop, payment({ recordedDays: null }));
    expect(slip.facts.map((f) => f.label)).not.toContain("Days recorded");
    // The rest of the payslip is still complete.
    expect(slip.facts.map((f) => f.label)).toContain("Unpaid days");
    expect(slip.facts.map((f) => f.label)).toContain("Per-day rate");
  });

  it("includes days-recorded when the snapshot has it", () => {
    const slip = payslipFromPayment(shop, payment({ recordedDays: 28 }));
    expect(slip.facts).toContainEqual({ label: "Days recorded", value: "28" });
  });
});

describe("payslip with an advance recovery", () => {
  const shop = { name: "BT", address: "", phone: "", currency: "₹" };

  it("is byte-identical to before when there is no recovery", () => {
    const slip = payslipFromPayroll(shop, row({ advanceRecovery: 0 }), 2026, 7);
    expect(slip.lines.map((l) => l.label)).not.toContain("Less: advance recovery");
    // The final row keeps its original wording when nothing is recovered.
    expect(slip.lines[slip.lines.length - 1].label).toBe("Net pay");
  });

  it("adds a recovery line and renames the final row", () => {
    const slip = payslipFromPayroll(
      shop,
      row({ net: 18000, computedNet: 18000, storedComputedNet: 18000, paymentId: "p1", advanceRecovery: 3000 }),
      2026,
      7,
    );
    const labels = slip.lines.map((l) => l.label);
    expect(labels).toContain("Less: advance recovery");
    expect(slip.lines[slip.lines.length - 1].label).toBe("Amount paid");
  });

  // The whole point: the document must state the amount actually handed over.
  it("states the payable amount, not the net salary", () => {
    const slip = payslipFromPayroll(
      shop,
      row({ net: 18000, computedNet: 18000, storedComputedNet: 18000, paymentId: "p1", advanceRecovery: 3000 }),
      2026,
      7,
    );
    expect(slip.net).toBe("₹15000.00");
    expect(slip.netInWords).toContain("Fifteen Thousand");
  });

  it("adds up: every minus line subtracted from the gross gives the payable", () => {
    const slip = payslipFromPayroll(
      shop,
      row({ gross: 20000, net: 18000, computedNet: 18000, storedComputedNet: 18000, paymentId: "p1", deduction: 2000, advanceRecovery: 3000 }),
      2026,
      7,
    );
    const num = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
    const total = slip.lines
      .filter((l) => !l.strong)
      .reduce((sum, l) => sum + (l.minus ? -num(l.value) : num(l.value)), 0);
    expect(total).toBeCloseTo(15000, 2);
  });

  it("shows the balance carried when something remains", () => {
    const slip = payslipFromPayroll(
      shop,
      row({ net: 18000, computedNet: 18000, storedComputedNet: 18000, paymentId: "p1", advanceRecovery: 3000, advanceBalance: 2000 }),
      2026,
      7,
    );
    expect(slip.facts.map((f) => f.label)).toContain("Advance balance carried");
  });
});