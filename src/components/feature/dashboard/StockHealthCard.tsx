"use client";

import { useMemo } from "react";
import { Package } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { ItemThumb } from "@/components/ui/ItemThumb";
import type { StockHealthRow, StockVerdict } from "@/lib/analytics";

const verdictBadge: Record<StockVerdict, string> = {
  "Reorder now": "badge-danger",
  "Reorder soon": "badge-warn",
  "Dead stock": "badge-brown",
  "Slow-moving": "badge-warn",
  Healthy: "badge-success",
};

const verdictRank: Record<StockVerdict, number> = {
  "Reorder now": 0,
  "Dead stock": 1,
  "Reorder soon": 2,
  "Slow-moving": 3,
  Healthy: 4,
};

export function StockHealthCard({
  loading,
  health,
  onRestock,
}: {
  loading: boolean;
  health: StockHealthRow[];
  onRestock: (itemId: string) => void;
}) {
  const attention = useMemo(
    () =>
      health
        .filter((s) => s.verdict !== "Healthy")
        .sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict]),
    [health],
  );

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="flex items-center gap-1.5">
          <Package size={16} /> Stock Health
        </h3>
        {attention.length > 0 && (
          <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-[11px] font-bold text-warn">
            {attention.length}
          </span>
        )}
      </div>
      {loading ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))
      ) : attention.length === 0 ? (
        <div className="p-3 text-center text-[12.5px] text-ink-muted">All items are healthy</div>
      ) : (
        attention.map((s) => {
          const needsRestock = s.verdict === "Reorder now" || s.verdict === "Reorder soon";
          return (
            <div
              key={s.item.id}
              className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0"
            >
              <ItemThumb src={s.item.imageUrl} emoji={s.item.emoji} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-bold">{s.item.name}</span>
                  <span className={`badge ${verdictBadge[s.verdict]} flex-shrink-0`}>
                    {s.verdict}
                  </span>
                </div>
                <div className="text-[11.5px] text-ink-light">
                  {s.item.qty} {s.item.unit} left
                  {s.daysCover !== null && ` · ${s.daysCover.toFixed(0)}d cover`}
                </div>
              </div>
              {needsRestock && (
                <button
                  className="rounded-[9px] bg-line-soft px-3 py-1.5 text-[12px] font-bold text-brown"
                  onClick={() => onRestock(s.item.id)}
                >
                  Restock
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
