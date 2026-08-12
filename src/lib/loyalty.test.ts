import { describe, expect, it } from "vitest";
import {
  combinedDiscount,
  occasionDiscount,
  occasionForToday,
  pointsEarned,
  pointsForValue,
  redeemValue,
  storeToday,
} from "./loyalty";
import type { LoyaltySettings } from "./types";

const S: LoyaltySettings = {
  enabled: true,
  pointsPerAmount: 1,
  pointsAmountUnit: 100,
  pointsPerRupee: 10,
  minRedeemPoints: 100,
  occasionDiscountPercent: 10,
  occasionDiscountCap: 200,
};
const OFF: LoyaltySettings = { ...S, enabled: false };

describe("pointsEarned", () => {
  it("grants one point per whole ₹100 block", () => {
    expect(pointsEarned(850, S)).toBe(8);
  });
  it("floors a partial block rather than rounding it up", () => {
    expect(pointsEarned(199.99, S)).toBe(1);
  });
  it("grants nothing below one whole block", () => {
    expect(pointsEarned(99, S)).toBe(0);
  });
  it("scales with pointsPerAmount", () => {
    expect(pointsEarned(850, { ...S, pointsPerAmount: 5 })).toBe(40);
  });
  it("grants nothing when the programme is off", () => {
    expect(pointsEarned(850, OFF)).toBe(0);
  });
});

describe("redeemValue and pointsForValue", () => {
  it("converts points to rupees at the configured rate", () => {
    expect(redeemValue(500, S)).toBe(50);
  });
  it("rounds the rupee value to the paisa", () => {
    expect(redeemValue(505, S)).toBe(50.5);
  });
  it("refuses a request below the minimum", () => {
    expect(redeemValue(99, S)).toBe(0);
  });
  it("refuses everything when the programme is off", () => {
    expect(redeemValue(500, OFF)).toBe(0);
  });
  it("round-trips rupees back to points", () => {
    expect(pointsForValue(50, S)).toBe(500);
  });
});

describe("occasionForToday", () => {
  const today = { year: 2026, month: 8, day: 12 };
  it("matches a birthday on the same month and day, ignoring the year", () => {
    expect(occasionForToday({ dob: "1990-08-12", anniversary: null }, today)).toBe("birthday");
  });
  it("matches an anniversary", () => {
    expect(occasionForToday({ dob: null, anniversary: "2015-08-12" }, today)).toBe("anniversary");
  });
  it("prefers the birthday when both fall today", () => {
    expect(
      occasionForToday({ dob: "1990-08-12", anniversary: "2015-08-12" }, today),
    ).toBe("birthday");
  });
  it("returns null on any other day", () => {
    expect(occasionForToday({ dob: "1990-08-13", anniversary: null }, today)).toBeNull();
  });
  it("returns null when no dates are on record", () => {
    expect(occasionForToday({ dob: null, anniversary: null }, today)).toBeNull();
  });
  it("matches a 29 February birthday on 28 February in a non-leap year", () => {
    expect(
      occasionForToday({ dob: "1992-02-29", anniversary: null }, { year: 2027, month: 2, day: 28 }),
    ).toBe("birthday");
  });
  it("does not match 29 February on 28 February in a leap year", () => {
    expect(
      occasionForToday({ dob: "1992-02-29", anniversary: null }, { year: 2028, month: 2, day: 28 }),
    ).toBeNull();
  });
});

describe("storeToday", () => {
  it("reads the calendar date in the store timezone, not UTC", () => {
    // 18:30 UTC on 11 Aug is already 12 Aug in Kolkata (UTC+5:30).
    expect(storeToday(new Date("2026-08-11T18:30:00Z"), "Asia/Kolkata")).toEqual({
      year: 2026,
      month: 8,
      day: 12,
    });
  });
});

describe("occasionDiscount", () => {
  it("is a percentage of the subtotal", () => {
    expect(occasionDiscount(850, "birthday", S)).toBe(85);
  });
  it("is capped in rupees", () => {
    expect(occasionDiscount(5000, "birthday", S)).toBe(200);
  });
  it("is zero without an occasion", () => {
    expect(occasionDiscount(850, null, S)).toBe(0);
  });
  it("is zero when the programme is off", () => {
    expect(occasionDiscount(850, "birthday", OFF)).toBe(0);
  });
});

describe("combinedDiscount", () => {
  it("sums all three when they fit inside the subtotal", () => {
    const r = combinedDiscount({ subtotal: 850, manual: 42.5, occasion: 85, redeem: 50, settings: S });
    expect(r).toEqual({
      total: 177.5,
      manual: 42.5,
      occasion: 85,
      redeem: 50,
      pointsRedeemed: 500,
    });
  });
  it("cuts redemption back first when the three exceed the subtotal", () => {
    // 100 + 100 + 100 = 300 against a 250 subtotal: redemption loses the 50.
    const r = combinedDiscount({ subtotal: 250, manual: 100, occasion: 100, redeem: 100, settings: S });
    expect(r.total).toBe(250);
    expect(r.manual).toBe(100);
    expect(r.occasion).toBe(100);
    expect(r.redeem).toBe(50);
    expect(r.pointsRedeemed).toBe(500);
  });
  it("cuts the occasion discount next, once redemption is exhausted", () => {
    const r = combinedDiscount({ subtotal: 150, manual: 100, occasion: 100, redeem: 100, settings: S });
    expect(r).toEqual({ total: 150, manual: 100, occasion: 50, redeem: 0, pointsRedeemed: 0 });
  });
  it("cuts the manual discount last", () => {
    const r = combinedDiscount({ subtotal: 60, manual: 100, occasion: 100, redeem: 100, settings: S });
    expect(r).toEqual({ total: 60, manual: 60, occasion: 0, redeem: 0, pointsRedeemed: 0 });
  });
  it("never returns a negative component", () => {
    const r = combinedDiscount({ subtotal: 0, manual: 100, occasion: 100, redeem: 100, settings: S });
    expect(r).toEqual({ total: 0, manual: 0, occasion: 0, redeem: 0, pointsRedeemed: 0 });
  });
});
