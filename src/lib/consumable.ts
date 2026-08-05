import type {
  ConsumableAlertKind,
  MovementType,
  StockStatus,
} from "./types";

/**
 * Pure consumable stock logic.
 *
 * `signedQty`, `movementError`, `stockStatusOf` and `recommendedQty` are MIRRORS
 * of the generated column and checks in `0062_consumables.sql` and
 * `record_stock_movement` in `0063`. The SQL copy is the authority — a form uses
 * these to refuse an impossible entry before the round trip, and to show what
 * the stock will be once the entry is saved.
 */

export const MOVEMENT_TYPES: MovementType[] = [
  "purchase",
  "issue",
  "return",
  "adjustment",
  "wastage",
  "expired",
  "damaged",
];

/** The four that write off value, so #91 §3.3 requires a reason on them. */
const REASON_REQUIRED: MovementType[] = [
  "adjustment",
  "wastage",
  "expired",
  "damaged",
];

export const reasonRequired = (t: MovementType): boolean =>
  REASON_REQUIRED.includes(t);

export type MovementDirection = "in" | "out" | "either";

/**
 * Direction is a property of the TYPE, not of the sign someone typed: wastage of
 * 5 and an issue of 5 both take 5 out. Only an adjustment can go either way,
 * because a stock count can.
 */
export function movementDirection(t: MovementType): MovementDirection {
  switch (t) {
    case "purchase":
    case "return":
      return "in";
    case "adjustment":
      return "either";
    default:
      return "out";
  }
}

/** Mirrors `stock_movement.qty_signed`, the column the running total sums. */
export function signedQty(t: MovementType, qty: number): number {
  switch (movementDirection(t)) {
    case "in":
      return Math.abs(qty);
    case "either":
      return qty;
    case "out":
      return -Math.abs(qty);
  }
}

/** What the stock will read once this movement is saved. */
export const stockAfter = (
  current: number,
  t: MovementType,
  qty: number,
): number => current + signedQty(t, qty);

/**
 * Everything `record_stock_movement` would reject, in the order it rejects it.
 * Returns a message, or null when the movement is good.
 *
 * The negative-stock rule is §3.4's one alert that BLOCKS rather than flags. The
 * server re-checks it under a row lock, so two people issuing the last of
 * something cannot both succeed — this copy only saves a round trip.
 */
export function movementError(
  current: number,
  t: MovementType,
  qty: number,
  reason: string,
  unit = "",
): string | null {
  if (!Number.isFinite(qty)) return "Enter a quantity";
  if (t === "adjustment") {
    if (qty === 0) return "An adjustment of zero changes nothing";
  } else if (qty <= 0) {
    return "A quantity has to be more than zero";
  }
  if (reasonRequired(t) && reason.trim() === "") {
    return "Say why this stock is being written off";
  }
  const after = stockAfter(current, t, qty);
  if (after < 0) {
    const suffix = unit ? ` ${unit}` : "";
    return `There is only ${current}${suffix} on hand`;
  }
  return null;
}

export function movementTypeLabel(t: MovementType): string {
  switch (t) {
    case "purchase":
      return "Purchase";
    case "issue":
      return "Issue";
    case "return":
      return "Return";
    case "adjustment":
      return "Adjustment";
    case "wastage":
      return "Wastage";
    case "expired":
      return "Expired";
    case "damaged":
      return "Damaged";
  }
}

// ─── Stock levels ───────────────────────────────────────────────────────────

/** Mirrors `consumable_v.stock_status`. */
export function stockStatusOf(
  current: number,
  minStock: number,
  reorderLevel: number | null,
): StockStatus {
  if (current <= 0) return "out";
  if (current < minStock) return "low";
  if (reorderLevel !== null && current <= reorderLevel) return "reorder";
  return "ok";
}

export function stockStatusLabel(s: StockStatus): string {
  switch (s) {
    case "out":
      return "Out of stock";
    case "low":
      return "Below minimum";
    case "reorder":
      return "At reorder level";
    case "ok":
      return "In stock";
  }
}

export function stockStatusTone(s: StockStatus): "bad" | "warn" | "info" | "good" {
  switch (s) {
    case "out":
      return "bad";
    case "low":
      return "warn";
    case "reorder":
      return "info";
    case "ok":
      return "good";
  }
}

/**
 * §3.5's suggestion engine, mirroring `consumable_v.recommended_qty`: top up to
 * the ceiling, or by the configured reorder quantity, or back to the floor — the
 * first of those that is actually configured. Zero when nothing needs ordering.
 */
export function recommendedQty(opts: {
  current: number;
  minStock: number;
  maxStock: number | null;
  reorderLevel: number | null;
  reorderQty: number | null;
}): number {
  const { current, minStock, maxStock, reorderLevel, reorderQty } = opts;
  const belowFloor = current < minStock;
  const atReorder = reorderLevel !== null && current <= reorderLevel;
  if (!belowFloor && !atReorder) return 0;
  if (reorderQty !== null) return reorderQty;
  if (maxStock !== null) return Math.max(maxStock - current, 0);
  return Math.max(minStock - current, 0);
}

// ─── Alerts (§3.4) ──────────────────────────────────────────────────────────

export function alertLabel(k: ConsumableAlertKind): string {
  switch (k) {
    case "out_of_stock":
      return "Out of stock";
    case "low_stock":
      return "Low stock";
    case "reorder":
      return "Reorder level";
    case "expired":
      return "Expired";
    case "expiring":
      return "Expiring soon";
    case "high_consumption":
      return "Unusual usage";
  }
}

/** Act-now alerts sort above act-soon ones, matching `severity` in the view. */
export const alertSeverity = (k: ConsumableAlertKind): 1 | 2 =>
  k === "out_of_stock" || k === "low_stock" || k === "expired" ? 2 : 1;
