"use client";

import { useBakeryStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/Skeleton";
import type { AssetStats } from "@/lib/types";

/**
 * #91 §4.1's asset widget row. Every figure comes from `asset_stats` in one round
 * trip, so the tiles cannot disagree with each other the way six separate counts
 * would. A tile with nothing in it is still shown — "0 under repair" is news.
 */
export function AssetTiles({
  stats,
  onPick,
}: {
  stats: AssetStats | null;
  /** Jumps the register to the matching filter. */
  onPick: (tile: "all" | "assigned" | "available" | "repair" | "service" | "warranty") => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);

  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[70px] w-full rounded-[14px]" />
        ))}
      </div>
    );
  }

  const tiles = [
    { key: "all" as const, label: "Assets", value: stats.total, tone: "" },
    { key: "assigned" as const, label: "Assigned", value: stats.assigned, tone: "" },
    { key: "available" as const, label: "Available", value: stats.available, tone: "" },
    {
      key: "repair" as const,
      label: "Under repair",
      value: stats.underRepair + stats.maintenance,
      tone: stats.underRepair + stats.maintenance > 0 ? "text-amber-700" : "",
    },
    {
      key: "service" as const,
      label: "Service due",
      value: stats.maintenanceDue,
      tone: stats.maintenanceDue > 0 ? "text-amber-700" : "",
    },
    {
      key: "warranty" as const,
      label: "Warranty ending",
      value: stats.warrantyExpiring,
      tone: stats.warrantyExpiring > 0 ? "text-amber-700" : "",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
        {stats.totalValue.toLocaleString("en-IN")} at purchase price
        {stats.repairCostMonth > 0 && (
          <>
            {" · "}
            {currency}
            {stats.repairCostMonth.toLocaleString("en-IN")} on repairs this month
          </>
        )}
        {stats.lost + stats.damaged > 0 && ` · ${stats.lost} lost, ${stats.damaged} damaged`}
        {stats.retired > 0 && ` · ${stats.retired} retired`}
      </p>
    </div>
  );
}
