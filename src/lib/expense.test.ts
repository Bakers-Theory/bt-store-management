import { describe, expect, it } from "vitest";
import {
  canTransition,
  expenseStatusLabel,
  gstSplit,
  isDuplicateInvoice,
  splitError,
  statusOnCreate,
} from "./expense";

describe("gstSplit", () => {
  it("treats gst as included in the amount, not added to it", () => {
    // A 5,000 bill with 250 of GST inside it: the base is 4,750.
    expect(gstSplit(5000, true, 250)).toEqual({ base: 4750, gst: 250 });
  });

  it("is all base when no gst is recorded", () => {
    expect(gstSplit(5000, false, 0)).toEqual({ base: 5000, gst: 0 });
  });

  it("ignores a stray gst figure when the flag is off", () => {
    // The flag is the authority; a leftover value must not silently apply.
    expect(gstSplit(5000, false, 250)).toEqual({ base: 5000, gst: 0 });
  });

  it("rounds to paise", () => {
    // The rounded gst is subtracted, not the raw figure, so base + gst is
    // always exactly the amount.
    expect(gstSplit(1000, true, 47.625)).toEqual({ base: 952.37, gst: 47.63 });
  });
});

describe("splitError", () => {
  it("accepts two positive legs that sum exactly", () => {
    expect(splitError(5000, 2000, 3000)).toBeNull();
  });

  it("rejects a sum that misses the total", () => {
    expect(splitError(5000, 2000, 2500)).toMatch(/must add up/i);
  });

  it("rejects a zero leg — that is not a mixed payment", () => {
    expect(splitError(5000, 0, 5000)).toMatch(/both/i);
    expect(splitError(5000, 5000, 0)).toMatch(/both/i);
  });

  it("rejects a negative leg", () => {
    expect(splitError(5000, -1000, 6000)).toMatch(/more than zero|both/i);
  });

  it("tolerates paise-level float drift rather than blocking a valid split", () => {
    expect(splitError(0.3, 0.1, 0.2)).toBeNull();
  });
});

describe("statusOnCreate", () => {
  it("is paid in one step for someone who can pay", () => {
    expect(statusOnCreate(true)).toBe("paid");
  });

  it("is pending for someone who cannot", () => {
    expect(statusOnCreate(false)).toBe("pending");
  });
});

describe("canTransition", () => {
  it("lets an approver pay or reject a pending expense", () => {
    expect(canTransition("pending", "paid", { canPay: true, canCancel: false })).toBe(true);
    expect(canTransition("pending", "rejected", { canPay: true, canCancel: false })).toBe(true);
  });

  it("refuses to pay or reject without expense.pay", () => {
    expect(canTransition("pending", "paid", { canPay: false, canCancel: true })).toBe(false);
    expect(canTransition("pending", "rejected", { canPay: false, canCancel: true })).toBe(false);
  });

  it("lets only expense.cancel void a paid expense", () => {
    expect(canTransition("paid", "cancelled", { canPay: true, canCancel: true })).toBe(true);
    expect(canTransition("paid", "cancelled", { canPay: true, canCancel: false })).toBe(false);
  });

  it("never reopens a settled expense", () => {
    const all = { canPay: true, canCancel: true };
    expect(canTransition("paid", "pending", all)).toBe(false);
    expect(canTransition("rejected", "paid", all)).toBe(false);
    expect(canTransition("cancelled", "paid", all)).toBe(false);
    expect(canTransition("cancelled", "pending", all)).toBe(false);
  });

  it("does not treat a pending expense as cancellable — it is rejected", () => {
    expect(canTransition("pending", "cancelled", { canPay: true, canCancel: true })).toBe(false);
  });
});

describe("expenseStatusLabel", () => {
  it("reads the way an operator would say it", () => {
    expect(expenseStatusLabel("pending")).toBe("Pending approval");
    expect(expenseStatusLabel("paid")).toBe("Paid");
    expect(expenseStatusLabel("rejected")).toBe("Rejected");
    expect(expenseStatusLabel("cancelled")).toBe("Cancelled");
  });
});

describe("isDuplicateInvoice", () => {
  it("matches ignoring case and surrounding space", () => {
    expect(isDuplicateInvoice(" inv-42 ", ["INV-42"])).toBe(true);
  });

  it("is false for a blank invoice number — most expenses have none", () => {
    expect(isDuplicateInvoice("", ["INV-42"])).toBe(false);
    expect(isDuplicateInvoice("   ", ["INV-42"])).toBe(false);
  });

  it("is false when nothing matches", () => {
    expect(isDuplicateInvoice("INV-43", ["INV-42"])).toBe(false);
  });
});
