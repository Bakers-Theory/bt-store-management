"use client";

import { Receipt } from "lucide-react";
import type { ItemPurchaseDraft } from "@/lib/item-purchase";
import type { Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-brown";

/**
 * The "record this as a purchase" block, shared by the two places a product can
 * be created from a supplier's Products tab: the single New product modal and
 * the CSV import.
 *
 * Renders nothing of its own about money. The invoice total is derived from the
 * costs already on the form, so there is no second figure here to disagree with
 * them, and no amount is displayed — `suppliers.financial` gates that, and this
 * block is shown on `purchases.create` alone.
 */
export function RecordAsPurchaseFields({
  supplier,
  draft,
  onChange,
  error,
  disabled,
}: {
  supplier: Supplier;
  draft: ItemPurchaseDraft;
  onChange: (next: ItemPurchaseDraft) => void;
  /** Shown only once the user has tried to save. */
  error?: string | null;
  disabled?: boolean;
}) {
  const inHouse = supplier.supplierType === "in_house";
  const set = (patch: Partial<ItemPurchaseDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="mb-3.5 rounded-[14px] border border-line bg-cream px-3.5 py-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={draft.record}
          disabled={disabled}
          onChange={(e) => set({ record: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#8a6a3c]"
        />
        <span>
          <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
            <Receipt size={14} /> Record this as a purchase from {supplier.name}
          </span>
          <span className="mt-0.5 block text-[11.5px] text-ink-muted">
            {draft.record
              ? inHouse
                ? "Files an in-house receipt for the opening stock, so the batch traces back to it."
                : "Files the invoice and what you owe, and the opening stock traces back to it."
              : "Off: the stock is recorded, but nothing is filed against this supplier's account. Right for products you already have on the shelf."}
          </span>
        </span>
      </label>

      {draft.record && (
        <div className={`mt-3 grid gap-2.5 ${inHouse ? "grid-cols-1" : "grid-cols-2"}`}>
          {/* An in-house receipt gets an IH-xxxx reference from the server
              instead; invoice_no must be NULL on one (0037:53). */}
          {!inHouse && (
            <div>
              <label className={labelCls} htmlFor="rap-no">
                Their invoice no. *
              </label>
              <input
                id="rap-no"
                type="text"
                placeholder="e.g. 4471"
                value={draft.invoiceNo}
                disabled={disabled}
                onChange={(e) => set({ invoiceNo: e.target.value })}
                className={inputCls}
              />
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="rap-date">
              Purchase date
            </label>
            <input
              id="rap-date"
              type="date"
              value={draft.purchaseDate}
              disabled={disabled}
              onChange={(e) => set({ purchaseDate: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-[12.5px] font-semibold text-danger">{error}</div>}
    </div>
  );
}
