import type { BillConsumableLine, BillMode } from "./types";

/**
 * Pure logic for consumables on a bill.
 *
 * `consumableLineError` is a MIRROR of the checks in `generate_bill`
 * (`0067_bill_consumables.sql`). The SQL copy is the authority — this exists so
 * the cart can refuse an impossible line before the round trip, and so the
 * biller sees the reason next to the line rather than as a failed checkout.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Trailing zeros dropped, so "2" not "2.000" — matches SQL's FM9999990.999. */
function qtyText(n: number): string {
  return String(round2(n));
}

/**
 * Which way a cart line starts. `"none"` is not reachable from the cart, but it
 * falls to absorbed rather than charged: billing a customer for something never
 * meant to be sold is the worse failure.
 */
export const defaultChargedFor = (mode: BillMode): boolean => mode === "charge";

/**
 * The charged lines' contribution to `bills.subtotal`, UNROUNDED.
 *
 * `computeTotals` must add this to the item lines and round the sum ONCE, because
 * that is what generate_bill does: `round(v_sub + v_csub, 2)`. Rounding this part
 * on its own and then rounding again after adding the items is a double rounding
 * the server never performs, and it can leave the cart's preview a paise away
 * from the total the customer is actually charged.
 */
export function chargedConsumableRaw(lines: BillConsumableLine[]): number {
  return lines
    .filter((l) => l.charged)
    .reduce((s, l) => s + l.qty * l.unitCost, 0);
}

/** The same figure rounded, for display on its own. */
export function chargedConsumableSubtotal(lines: BillConsumableLine[]): number {
  return round2(chargedConsumableRaw(lines));
}

/** What the absorbed lines take out of the cash book. */
export function absorbedConsumableCost(lines: BillConsumableLine[]): number {
  return round2(
    lines.filter((l) => !l.charged).reduce((s, l) => s + l.qty * l.unitCost, 0),
  );
}

/**
 * Everything `generate_bill` would reject, in the order it rejects it. Null when
 * the line is fine.
 *
 * A charged line needs a cost — billing ₹0 for a bag is not what "charge the
 * customer" means. An absorbed line with no cost is fine: it posts nothing.
 */
export function consumableLineError(
  line: BillConsumableLine,
  currentStock: number,
): string | null {
  if (!(line.qty > 0)) return "A quantity has to be more than zero.";
  if (line.charged && !(line.unitCost > 0)) {
    return `Set a cost per unit on ${line.name} before charging it on a bill.`;
  }
  if (line.qty > currentStock) {
    return `There is only ${qtyText(currentStock)} ${line.unit} of ${line.name} on hand.`;
  }
  return null;
}