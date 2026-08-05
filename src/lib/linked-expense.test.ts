import { describe, expect, it } from "vitest";
import {
  draftToInput,
  emptyLinkedExpense,
  linkedExpenseError,
  linkedExpenseSummary,
  type LinkedExpenseDraft,
} from "./linked-expense";

const TODAY = "2026-08-05";

const draft = (over: Partial<LinkedExpenseDraft> = {}): LinkedExpenseDraft => ({
  ...emptyLinkedExpense(TODAY, { canRecord: true, canPay: true }),
  categoryId: "cat-1",
  ...over,
});

describe("emptyLinkedExpense", () => {
  it("follows the permissions: no expense key, no block, and no pay", () => {
    const d = emptyLinkedExpense(TODAY, { canRecord: false, canPay: false });
    expect(d.record).toBe(false);
    expect(d.pay).toBe(false);
  });

  it("leaves it on and paid for someone who can do both", () => {
    const d = emptyLinkedExpense(TODAY, { canRecord: true, canPay: true });
    expect(d.record).toBe(true);
    expect(d.pay).toBe(true);
    expect(d.paidOn).toBe(TODAY);
  });
});

describe("linkedExpenseError", () => {
  it("is silent when nothing is being recorded, whatever else is missing", () => {
    expect(
      linkedExpenseError(draft({ record: false, categoryId: "" }), 0, TODAY),
    ).toBeNull();
  });

  it("needs a cost", () => {
    expect(linkedExpenseError(draft(), 0, TODAY)).toMatch(/what this cost/i);
    expect(linkedExpenseError(draft(), Number.NaN, TODAY)).toMatch(/what this cost/i);
  });

  it("needs a category", () => {
    expect(linkedExpenseError(draft({ categoryId: "" }), 500, TODAY)).toMatch(
      /category/i,
    );
  });

  it("keeps GST inside the total, as the schema does", () => {
    expect(
      linkedExpenseError(draft({ gstIncluded: true, gstAmount: "500" }), 500, TODAY),
    ).toMatch(/less than/i);
    expect(
      linkedExpenseError(draft({ gstIncluded: true, gstAmount: "90" }), 500, TODAY),
    ).toBeNull();
  });

  it("ignores a leftover GST figure once the box is unticked", () => {
    expect(
      linkedExpenseError(draft({ gstIncluded: false, gstAmount: "900" }), 500, TODAY),
    ).toBeNull();
  });

  it("refuses a future payment date, but only when it is being paid", () => {
    expect(linkedExpenseError(draft({ paidOn: "2026-08-06" }), 500, TODAY)).toMatch(
      /future/i,
    );
    expect(
      linkedExpenseError(draft({ paidOn: "2026-08-06", pay: false }), 500, TODAY),
    ).toBeNull();
  });
});

describe("draftToInput", () => {
  it("is null when the block is off — the RPCs read that as 'no spend'", () => {
    expect(draftToInput(draft({ record: false }))).toBeNull();
  });

  it("never carries an amount: the server derives it from the record", () => {
    const input = draftToInput(draft())!;
    expect(input).not.toHaveProperty("amount");
  });

  it("drops the payment date when the expense is not being paid", () => {
    expect(draftToInput(draft({ pay: false }))!.paidOn).toBe("");
  });

  it("zeroes GST when the box is unticked, and rounds it when it is", () => {
    expect(draftToInput(draft({ gstIncluded: false, gstAmount: "90" }))!.gstAmount)
      .toBe(0);
    expect(draftToInput(draft({ gstIncluded: true, gstAmount: "90.456" }))!.gstAmount)
      .toBe(90.46);
  });

  it("sends no supplier rather than an empty string", () => {
    expect(draftToInput(draft())!.vendorSupplierId).toBeNull();
    expect(draftToInput(draft({ vendorSupplierId: "s1" }))!.vendorSupplierId).toBe("s1");
  });
});

describe("linkedExpenseSummary", () => {
  it("names the account the money leaves", () => {
    expect(linkedExpenseSummary(draft({ paymentMode: "Cash" }), 4500, "₹")).toMatch(
      /cash in hand/,
    );
    expect(linkedExpenseSummary(draft({ paymentMode: "UPI" }), 4500, "₹")).toMatch(
      /the bank/,
    );
  });

  it("says it is waiting when it is not being paid", () => {
    expect(linkedExpenseSummary(draft({ pay: false }), 4500, "₹")).toMatch(/approval/);
  });
});
