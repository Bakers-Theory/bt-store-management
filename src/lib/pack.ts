/**
 * Packs and loose pieces.
 *
 * Some stock is bought as a pack of 100 and sold three at a time. Migration
 * 0073 models that as two numbers rather than one fractional one: the batch
 * ledger keeps counting PACKS, and `looseQty` counts the pieces broken out of
 * an opened pack. A pack opens itself when a piece sale runs the loose count
 * dry — the cashier never has to say so.
 *
 * Everything here mirrors a server-side rule. The server is authoritative; this
 * exists so the cart previews the same figures the receipt will show.
 */

import type { SellMode } from "./types";

/** True when this item or consumable may be sold by the piece. */
export function isPacked(packSize: number | null): packSize is number {
  return packSize !== null && packSize > 1;
}

/**
 * The price of one piece: the pack price split evenly, to the paisa. Mirrors
 * `piece_price()` in migration 0073.
 *
 * The rounding is real and deliberate — a ₹100 pack of 3 sells as three ₹33.33
 * pieces and yields ₹99.99. A separate stored piece price would avoid that at
 * the cost of a second figure to keep in step with the first.
 */
export function piecePrice(price: number, packSize: number | null): number {
  if (!isPacked(packSize)) return price;
  return Math.round((price / packSize + Number.EPSILON) * 100) / 100;
}

/**
 * How many pieces could be sold right now: every piece still inside a whole
 * pack, plus the ones already loose. Mirrors what `consume_pieces` will accept
 * before it raises.
 */
export function piecesAvailable(
  packQty: number,
  looseQty: number,
  packSize: number | null,
): number {
  if (!isPacked(packSize)) return packQty;
  return packQty * packSize + looseQty;
}

/**
 * "2 packs + 40 pcs", or just "2 box" for anything not sold in packs. The unit
 * label is the item's own, so a store that calls them "bags" still reads right.
 */
export function stockLabel(
  packQty: number,
  looseQty: number,
  packSize: number | null,
  unit: string,
): string {
  const packs = `${packQty} ${unit}`;
  if (!isPacked(packSize) || looseQty <= 0) return packs;
  return `${packs} + ${looseQty} pcs`;
}

/** The unit printed on a line — a piece line is always "pcs". */
export function unitFor(mode: SellMode, unit: string): string {
  return mode === "piece" ? "pcs" : unit;
}
