import { describe, expect, it } from "vitest";
import { expiryStatus } from "./expiry";

const today = new Date(2026, 6, 7); // 2026-07-07 (month is 0-indexed)

describe("expiryStatus", () => {
  it("returns 'none' when the item does not track expiry", () => {
    expect(expiryStatus("2026-07-01", false, 3, today)).toBe("none");
  });

  it("returns 'none' when there is no dated stock", () => {
    expect(expiryStatus(null, true, 3, today)).toBe("none");
  });

  it("returns 'expired' when the earliest batch date is before today", () => {
    expect(expiryStatus("2026-07-06", true, 3, today)).toBe("expired");
  });

  it("returns 'expiring' when the date is today (within window)", () => {
    expect(expiryStatus("2026-07-07", true, 3, today)).toBe("expiring");
  });

  it("returns 'expiring' at the window boundary (windowDays away)", () => {
    expect(expiryStatus("2026-07-10", true, 3, today)).toBe("expiring");
  });

  it("returns 'fresh' just beyond the window", () => {
    expect(expiryStatus("2026-07-11", true, 3, today)).toBe("fresh");
  });
});
