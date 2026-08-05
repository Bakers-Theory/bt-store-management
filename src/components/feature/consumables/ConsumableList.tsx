"use client";

import { ChevronRight, CalendarClock } from "lucide-react";
import { stockStatusLabel, stockStatusTone } from "@/lib/consumable";
import type { Consumable } from "@/lib/types";

const toneCls = {
  bad: "bg-red-100 text-red-800",
  warn: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
  good: "bg-green-100 text-green-800",
} as const;

/** Trailing zeros on a stock figure are noise: 5.000 kg reads as 5 kg. */
export const qtyLabel = (n: number): string =>
  Number(n.toFixed(3)).toLocaleString("en-IN", { maximumFractionDigits: 3 });

export function ConsumableList({
  items,
  onOpen,
}: {
  items: Consumable[];
  onOpen: (c: Consumable) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center">
        <p className="text-sm font-semibold text-ink">No items</p>
        <p className="mt-1 text-xs text-ink-muted">Nothing matches these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      {items.map((c) => {
        const expiring = c.expiryDaysLeft !== null && c.expiryDaysLeft <= 30;
        return (
          <button
            key={c.id}
            onClick={() => onOpen(c)}
            className="flex w-full items-center gap-3 border-t border-line-soft px-5 py-3.5 text-left first:border-t-0 hover:bg-[#faf4ea]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink">
                {c.name}
                <span className="ml-1.5 font-normal text-ink-muted">{c.code}</span>
              </p>
              <p className="truncate text-[11px] text-ink-muted">
                {c.category}
                {c.storageLocation && ` · ${c.storageLocation}`}
                {` · min ${qtyLabel(c.minStock)} ${c.unit}`}
                {c.recommendedQty > 0 && ` · order ${qtyLabel(c.recommendedQty)} ${c.unit}`}
              </p>
            </div>

            {expiring && (
              <CalendarClock
                size={14}
                aria-label={c.expiryDaysLeft! < 0 ? "Expired" : "Expiring soon"}
                className={`shrink-0 ${c.expiryDaysLeft! < 0 ? "text-red-600" : "text-amber-600"}`}
              />
            )}

            <span className="shrink-0 text-right">
              <span className="block text-sm font-bold tabular-nums text-ink">
                {qtyLabel(c.currentStock)} {c.unit}
              </span>
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  toneCls[stockStatusTone(c.stockStatus)]
                }`}
              >
                {stockStatusLabel(c.stockStatus)}
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-[#c0a880]" />
          </button>
        );
      })}
    </div>
  );
}
