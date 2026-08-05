"use client";

import { Package } from "lucide-react";
import { absorbedConsumableCost, consumableLineError } from "@/lib/bill-consumable";
import type { BillableConsumable } from "@/lib/supabase-data";
import type { BillConsumableLine } from "@/lib/types";

/**
 * The consumables a biller may add to a bill.
 *
 * The On bill / Absorbed toggle is the whole feature in one control: "On bill"
 * prints the line AND charges for it, "Absorbed" does neither and sends the cost
 * to the cash book instead. They are one switch because the alternative allows a
 * line the customer pays for but cannot see.
 */
export function ConsumablePicker({
  available,
  search,
  inCart,
  onAdd,
  currency,
}: {
  available: BillableConsumable[];
  search: string;
  /** Quantity already in the cart, per consumable id — mirrors the item grid's badge. */
  inCart: Map<string, number>;
  onAdd: (c: BillableConsumable) => void;
  currency: string;
}) {
  const q = search.toLowerCase();
  // Nothing on the shelf cannot be issued, so it is not offered — the same rule
  // filteredItems applies to products with no fresh stock.
  const shown = available.filter(
    (c) =>
      c.currentStock > 0 &&
      (c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)),
  );

  // The caller only renders this section when consumables exist, so an empty
  // `shown` means the search excluded them or the shelf is bare.
  if (shown.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-warm-white p-8 text-center text-ink-light">
        <div className="mb-2 flex justify-center">
          <Package size={26} />
        </div>
        <div className="text-[13px] font-semibold">
          {search.trim() === ""
            ? "None are in stock"
            : "Nothing here matches your search"}
        </div>
        {search.trim() === "" && (
          <div className="mt-0.5 text-[11.5px]">
            Record a purchase to put stock on the shelf.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
      {shown.map((c) => {
        const qty = inCart.get(c.id) ?? 0;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onAdd(c)}
            className={`flex w-full flex-col gap-[6px] rounded-2xl border-[1.5px] p-3 text-left transition-all ${
              qty
                ? "border-brown bg-warm-white shadow-[0_3px_12px_rgba(124,74,30,.14)]"
                : "border-line bg-warm-white shadow-[0_1px_3px_rgba(100,60,20,.05)]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-[13.5px] font-bold leading-tight">
                {c.name}
              </span>
              {qty > 0 && (
                <span className="num shrink-0 rounded-full bg-brown px-2 py-0.5 text-[11px] font-extrabold text-warm-white">
                  {qty}
                </span>
              )}
            </div>
            <div className="num text-[13px] font-extrabold text-brown">
              {currency}
              {c.costPerUnit.toFixed(2)}
              <span className="text-[11.5px] font-semibold text-ink-muted"> / {c.unit}</span>
            </div>
            <div className="num text-[11.5px] font-semibold text-ink-muted">
              {c.currentStock} {c.unit} on hand
            </div>
            <span className="w-fit rounded-full bg-cream-dark px-2 py-0.5 text-[10.5px] font-bold text-ink-muted">
              {c.billMode === "charge" ? "Charged" : "Absorbed"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ConsumableCartGroup({
  lines,
  available,
  onSetQty,
  onToggleCharged,
  currency,
}: {
  lines: BillConsumableLine[];
  available: BillableConsumable[];
  onSetQty: (consumableId: string, qty: number) => void;
  onToggleCharged: (consumableId: string) => void;
  currency: string;
}) {
  if (lines.length === 0) return null;

  const stockOf = (id: string) => available.find((a) => a.id === id)?.currentStock ?? 0;
  const absorbed = absorbedConsumableCost(lines);

  return (
    <div className="border-t border-line-soft px-2 py-1.5">
      <div className="px-2.5 pb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-ink-light">
        Consumables
      </div>
      {lines.map((l) => {
        const err = consumableLineError(l, stockOf(l.consumableId));
        return (
          <div key={l.consumableId} className="rounded-xl px-2.5 py-[9px]">
            <div className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold">{l.name}</div>
                <div className="num text-[11.5px] text-ink-light">
                  {currency}
                  {l.unitCost.toFixed(2)} / {l.unit}
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-[9px] bg-cream-dark p-[3px]">
                <button
                  onClick={() => onSetQty(l.consumableId, l.qty - 1)}
                  aria-label={`Remove one ${l.name}`}
                  className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-base font-extrabold text-brown"
                >
                  −
                </button>
                <span className="num min-w-[20px] text-center text-[13.5px] font-extrabold">
                  {l.qty}
                </span>
                <button
                  onClick={() => onSetQty(l.consumableId, l.qty + 1)}
                  disabled={l.qty >= stockOf(l.consumableId)}
                  aria-label={`Add one ${l.name}`}
                  className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-base font-extrabold text-brown disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
              </div>
              <div className="num w-[62px] text-right text-[13.5px] font-extrabold">
                {l.charged ? (
                  `${currency}${(l.qty * l.unitCost).toFixed(2)}`
                ) : (
                  <span className="text-ink-light">—</span>
                )}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5">
              <span className="inline-flex overflow-hidden rounded-[7px] border border-line">
                {([true, false] as const).map((on) => (
                  <button
                    key={String(on)}
                    type="button"
                    onClick={() => {
                      if (l.charged !== on) onToggleCharged(l.consumableId);
                    }}
                    aria-pressed={l.charged === on}
                    aria-label={
                      on ? `Charge ${l.name} on the bill` : `Absorb the cost of ${l.name}`
                    }
                    className={`px-2 py-1 text-[11.5px] font-bold ${
                      l.charged === on
                        ? "bg-brown text-warm-white"
                        : "bg-warm-white text-ink-muted"
                    }`}
                  >
                    {on ? "On bill" : "Absorbed"}
                  </button>
                ))}
              </span>
              {err && (
                <span className="text-[11.5px] font-semibold text-danger">{err}</span>
              )}
            </div>
          </div>
        );
      })}
      {absorbed > 0 && (
        <div className="flex justify-between px-2.5 pt-1 text-[11.5px] font-semibold text-ink-light">
          <span>Absorbed cost (not charged)</span>
          <span className="num">
            {currency}
            {absorbed.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
