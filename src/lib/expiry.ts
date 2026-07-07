export type ExpiryStatus = "none" | "fresh" | "expiring" | "expired";

/**
 * Classify an item's expiry status from its earliest in-stock batch date.
 * - "none": item doesn't track expiry, or has no dated stock.
 * - "expired": earliest batch date is before today.
 * - "expiring": earliest batch date is within `windowDays` of today (inclusive).
 * - "fresh": otherwise.
 * Compared at day granularity in local time. `earliestExpiry` is a "YYYY-MM-DD" date.
 */
export function expiryStatus(
  earliestExpiry: string | null,
  tracksExpiry: boolean,
  windowDays: number,
  today: Date,
): ExpiryStatus {
  if (!tracksExpiry || !earliestExpiry) return "none";
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = earliestExpiry.split("-").map(Number);
  const exp = new Date(y, m - 1, d);
  const days = Math.round((exp.getTime() - start.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= windowDays) return "expiring";
  return "fresh";
}
