/**
 * Recording a newly created product's opening stock as a purchase.
 *
 * A product added from a supplier's Products tab is almost always something they
 * just delivered, and `create_item` files no purchase: it makes the batch and
 * nothing else (0071). Ticking the box on those forms posts an invoice for the
 * opening stock instead, which is the lane this app already uses for items —
 * `stock_in` is explicitly the NON-purchase path (0037 note 1).
 *
 * WHY THE OPENING QTY MOVES TO THE INVOICE. `post_purchase_invoice` calls
 * `add_batch` itself (0040:129), so a product whose purchase is being recorded
 * must be created with qty 0 or its stock lands twice. `linesFrom` below is what
 * carries the quantity across, and `withoutOpeningQty` is what takes it off the
 * create.
 *
 * Pure: these are the checks `save_purchase_invoice` (0037:193) and the table
 * constraints above it will make anyway, mirrored so a form can refuse before
 * the round trip. The SQL is the authority.
 */
import type { DraftLine } from "./purchase";
import type { SupplierType } from "./types";

/** What the "record as a purchase" block on a form holds. */
export interface ItemPurchaseDraft {
  /** The tick. Default on: a delivery is the common case on a supplier's tab. */
  record: boolean;
  /** Required for an external supplier, discarded for in-house. */
  invoiceNo: string;
  purchaseDate: string;
}

export const emptyItemPurchaseDraft = (today: string): ItemPurchaseDraft => ({
  record: true,
  invoiceNo: "",
  purchaseDate: today,
});

/**
 * Why this purchase cannot be posted yet, or null. Only meaningful when
 * `record` is on — an unticked block is never invalid.
 */
export function itemPurchaseError(
  draft: ItemPurchaseDraft,
  supplierType: SupplierType,
  today: string,
): string | null {
  if (!draft.record) return null;
  // in_house_has_no_invoice_no (0037:53). The server nulls it and issues an
  // IH-xxxx reference instead, so asking for one would be asking for nothing.
  if (supplierType === "external" && draft.invoiceNo.trim() === "") {
    return "Enter the supplier's invoice number";
  }
  if (draft.purchaseDate === "") return "Choose the purchase date";
  if (draft.purchaseDate > today) return "A purchase date cannot be in the future";
  return null;
}

/** One product's opening stock, as a form or an import row holds it. */
export interface OpeningStock {
  itemId: string;
  qty: number;
  costPrice: number;
  gstRate: number;
  expiryDate: string | null;
}

/**
 * The invoice lines for a set of newly created products. Products with no
 * opening stock are LEFT OUT rather than sent as a zero line: `qty > 0` is a
 * table constraint (0037:93), and an invoice for no goods is not a purchase.
 * An empty result means there is nothing to post at all.
 */
export const linesFrom = (stock: OpeningStock[]): DraftLine[] =>
  stock
    .filter((s) => s.qty > 0)
    .map((s) => ({
      itemId: s.itemId,
      qty: s.qty,
      unitCost: s.costPrice,
      // Discarded server-side for an in-house receipt, which carries no GST.
      gstRate: s.gstRate,
      expiry: s.expiryDate,
    }));

/** One consumable's opening stock, as a form or an import row holds it. */
export interface OpeningConsumableStock {
  consumableId: string;
  qty: number;
  /** Null when the operator never priced it; the line then costs nothing. */
  costPerUnit: number | null;
  gstRate: number;
}

/**
 * The same, for consumables (migration 0072). No expiry: a consumable's expiry
 * is a property of the record rather than of the delivery, so there is nothing
 * per-line to carry.
 */
export const consumableLinesFrom = (stock: OpeningConsumableStock[]): DraftLine[] =>
  stock
    .filter((s) => s.qty > 0)
    .map((s) => ({
      itemId: "",
      consumableId: s.consumableId,
      qty: s.qty,
      unitCost: s.costPerUnit ?? 0,
      gstRate: s.gstRate,
      expiry: null,
    }));

/**
 * The same product input with its opening quantity removed, for creating an item
 * whose stock the invoice will bring in. `supplierId` goes too: the batch this
 * no longer creates is the only thing that could have carried it, and posting
 * stamps both the supplier AND the invoice on the batch it makes instead.
 */
export const withoutOpeningQty = <T extends { qty: number; supplierId?: string | null }>(
  input: T,
): T => ({ ...input, qty: 0, supplierId: null });
