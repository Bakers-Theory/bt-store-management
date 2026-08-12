/**
 * Loyalty arithmetic — points, occasion discounts, and how the three
 * reductions on a bill combine.
 *
 * Every function here is pure and is mirrored bit-for-bit by migration 0070,
 * the same discipline `gst.ts` keeps with `generate_bill`. The on-screen
 * preview must match the stored bill to the paisa, so the rounding ORDER
 * matters as much as the formulae. Do not "simplify" a round() away without
 * changing the SQL in the same commit.
 *
 * Every function short-circuits to zero when `settings.enabled` is false, so a
 * store that has not opted in behaves exactly as it did before the programme
 * existed — the caller never has to remember to check the flag.
 */
import type { LoyaltySettings, OccasionKind } from "./types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A calendar date as read in the store's timezone. */
export interface StoreToday {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

/**
 * Today's calendar date in `tz`. A bill rung up at 01:30 IST on 12 August is a
 * 12 August birthday even though it is still 11 August in UTC — the same
 * timezone discipline `financialYear` in gst.ts keeps.
 */
export function storeToday(now: Date, tz: string): StoreToday {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Points a bill grants, on the total the customer actually paid. */
export function pointsEarned(total: number, s: LoyaltySettings): number {
  if (!s.enabled || s.pointsAmountUnit <= 0 || s.pointsPerAmount <= 0) return 0;
  return Math.floor(total / s.pointsAmountUnit) * s.pointsPerAmount;
}

/**
 * What `points` are worth in rupees. A request below `minRedeemPoints` buys
 * nothing at all rather than being rounded down to a token amount.
 */
export function redeemValue(points: number, s: LoyaltySettings): number {
  if (!s.enabled || s.pointsPerRupee <= 0) return 0;
  if (points < s.minRedeemPoints) return 0;
  return round2(points / s.pointsPerRupee);
}

/** The inverse of `redeemValue`, used to burn only the points that were spent. */
export function pointsForValue(value: number, s: LoyaltySettings): number {
  if (!s.enabled || s.pointsPerRupee <= 0) return 0;
  return Math.round(value * s.pointsPerRupee);
}

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * True when a stored "YYYY-MM-DD" falls on `today`, comparing month and day
 * only. A 29 February date matches 28 February in a non-leap year, so those
 * customers are not skipped three years in four.
 */
function fallsToday(date: string | null, today: StoreToday): boolean {
  if (!date) return false;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month === today.month && day === today.day) return true;
  return (
    month === 2 && day === 29 && today.month === 2 && today.day === 28 && !isLeapYear(today.year)
  );
}

/**
 * Which occasion today is for this customer, or null. A birthday wins when both
 * fall on the same day: one occasion discount per bill, never two.
 */
export function occasionForToday(
  customer: { dob: string | null; anniversary: string | null },
  today: StoreToday,
): OccasionKind | null {
  if (fallsToday(customer.dob, today)) return "birthday";
  if (fallsToday(customer.anniversary, today)) return "anniversary";
  return null;
}

/** The occasion discount in rupees, capped. Zero without an occasion. */
export function occasionDiscount(
  subtotal: number,
  kind: OccasionKind | null,
  s: LoyaltySettings,
): number {
  if (!s.enabled || kind === null) return 0;
  const pct = Math.min(100, Math.max(0, s.occasionDiscountPercent));
  return Math.min(round2((subtotal * pct) / 100), s.occasionDiscountCap);
}

export interface CombinedDiscount {
  /** The single figure handed to the pro-rata allocator. */
  total: number;
  manual: number;
  occasion: number;
  redeem: number;
  /** Points actually burned — derived from `redeem` AFTER any cut-back. */
  pointsRedeemed: number;
}

/**
 * Fold the three reductions into one rupee figure.
 *
 * When they exceed the subtotal the overflow is cut back in a fixed order:
 * REDEMPTION first, then the OCCASION discount, then the MANUAL one. So the
 * reduction the biller typed always survives, and points that would have bought
 * nothing stay on the customer's balance for a later visit instead of being
 * burned against a bill that was already fully covered.
 */
export function combinedDiscount(input: {
  subtotal: number;
  manual: number;
  occasion: number;
  redeem: number;
  settings: LoyaltySettings;
}): CombinedDiscount {
  const { subtotal, settings } = input;
  let manual = Math.max(0, input.manual);
  let occasion = Math.max(0, input.occasion);
  let redeem = Math.max(0, input.redeem);

  let overflow = round2(manual + occasion + redeem - subtotal);
  if (overflow > 0) {
    // Order matters: whatever is cut first is what the customer keeps.
    const takeFrom = (value: number): number => {
      const cut = Math.min(value, overflow);
      overflow = round2(overflow - cut);
      return round2(value - cut);
    };
    redeem = takeFrom(redeem);
    occasion = takeFrom(occasion);
    manual = takeFrom(manual);
  }

  return {
    total: round2(manual + occasion + redeem),
    manual,
    occasion,
    redeem,
    pointsRedeemed: pointsForValue(redeem, settings),
  };
}
