import { describe, expect, it } from "vitest";
import {
  absorbedConsumableCost,
  chargedConsumableRaw,
  chargedConsumableSubtotal,
  consumableLineError,
  defaultChargedFor,
} from "./bill-consumable";
import type { BillConsumableLine } from "./types";

const line = (
  qty: number,
  unitCost: number,
  charged: boolean,
  over: Partial<BillConsumableLine> = {},
): BillConsumableLine => ({
  consumableId: "c1",
  name: "Carry bag",
  unit: "pcs",
  qty,
  unitCost,
  charged,
  hsn: "",
  gstRate: 0,
  ...over,
});

describe("defaultChargedFor", () => {
  it("charges only in charge mode", () => {
    expect(defaultChargedFor("charge")).toBe(true);
    expect(defaultChargedFor("absorb")).toBe(false);
  });

  it("treats an unbillable consumable as absorbed rather than charged", () => {
    // "none" is unreachable from the cart, but guessing "charge" here would
    // silently bill a customer for something never meant to be sold.
    expect(defaultChargedFor("none")).toBe(false);
  });
});

describe("chargedConsumableSubtotal", () => {
  it("sums only the charged lines", () => {
    expect(
      chargedConsumableSubtotal([line(2, 5, true), line(3, 4, false)]),
    ).toBe(10);
  });

  it("is zero when nothing is charged", () => {
    expect(chargedConsumableSubtotal([line(3, 4, false)])).toBe(0);
  });

  it("sums fractional quantities without floating-point dust", () => {
    // 0.1 + 0.2 style drift: 3 x 0.1 x 1.10 = 0.33, not 0.33000000000000007.
    expect(chargedConsumableSubtotal([line(0.1, 1.1, true), line(0.2, 1.1, true)]))
      .toBe(0.33);
  });
});

describe("chargedConsumableRaw", () => {
  it("does not round, so computeTotals can round once over the whole subtotal", () => {
    // generate_bill computes round(v_sub + v_csub, 2) — a single rounding. If
    // this rounded on its own, the cart preview could sit a paise off the total
    // the customer is charged.
    expect(chargedConsumableRaw([line(3, 0.005, true)])).toBeCloseTo(0.015, 10);
  });

  it("ignores absorbed lines", () => {
    expect(chargedConsumableRaw([line(2, 5, false)])).toBe(0);
  });
});

describe("absorbedConsumableCost", () => {
  it("sums only the absorbed lines", () => {
    expect(absorbedConsumableCost([line(2, 5, true), line(3, 4, false)])).toBe(12);
  });

  it("is zero when everything is charged, so nothing posts out", () => {
    expect(absorbedConsumableCost([line(2, 5, true)])).toBe(0);
  });
});

describe("consumableLineError", () => {
  it("accepts a line within stock", () => {
    expect(consumableLineError(line(2, 5, true), 10)).toBeNull();
  });

  it("rejects a quantity over stock, naming what is on hand", () => {
    expect(consumableLineError(line(3, 5, true), 2)).toBe(
      "There is only 2 pcs of Carry bag on hand.",
    );
  });

  it("rejects a charged line with no cost set", () => {
    expect(consumableLineError(line(1, 0, true), 10)).toBe(
      "Set a cost per unit on Carry bag before charging it on a bill.",
    );
  });

  it("allows an absorbed line with no cost — it simply posts nothing", () => {
    expect(consumableLineError(line(1, 0, false), 10)).toBeNull();
  });

  it("rejects a non-positive quantity", () => {
    expect(consumableLineError(line(0, 5, true), 10)).toBe(
      "A quantity has to be more than zero.",
    );
  });
});