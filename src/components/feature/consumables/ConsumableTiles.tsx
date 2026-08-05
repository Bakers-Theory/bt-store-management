"use client";

import { useBakeryStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ConsumableStats } from "@/lib/types";

/**
 * #91 §4.1's consumables widget row, from `consumable_stats` in one round trip.
 * Consumption and purchase figures are month-to-date on the store's calendar,
 * matching the cashbook's convention.
 */
export function ConsumableTiles({
  stats,
  onPick,
}: {
  stats: ConsumableStats | null;
  onPick: (tile: "all" | "low" | "out" | "expiring") => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);

  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[70px] w-full rounded-[14px]" />
        ))}
      </div>
    );
  }

  const tiles = [
    { key: "all" as const, label: "Items", value: stats.totalItems, tone: "" },
    {
      key: "low" as const,
      label: "Below minimum",
      value: stats.lowStock,
      tone: stats.lowStock > 0 ? "text-amber-700" : "",
    },
    {
      key: "out" as const,
      label: "Out of stock",
      value: stats.outOfStock,
      tone: stats.outOfStock > 0 ? "text-red-700" : "",
    },
    {
      key: "expiring" as const,
      label: "Expiring soon",
      value: stats.expiringSoon,
      tone: stats.expiringSoon > 0 ? "text-amber-700" : "",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => onPick(t.key)}
            className="rounded-[14px] border border-line bg-warm-white px-3 py-2.5 text-left shadow-[0_2px_12px_rgba(100,60,20,0.05)]"
          >
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a6a3c]">
              {t.label}
            </p>
            <p className={`text-xl font-extrabold tabular-nums ${t.tone || "text-ink"}`}>
              {t.value}
            </p>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-ink-muted">
        {currency}
        {stats.stockValue.toLocaleString("en-IN")} on the shelf · bought{" "}
        {currency}
        {stats.monthPurchaseCost.toLocaleString("en-IN")} this month
        {stats.monthWastageQty > 0 && ` · ${stats.monthWastageQty} written off`}
        {stats.mostUsed.length > 0 &&
          ` · most used: ${stats.mostUsed
            .slice(0, 3)
            .map((m) => `${m.name} (${m.qty} ${m.unit})`)
            .join(", ")}`}
      </p>
    </div>
  );
}
