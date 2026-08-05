"use client";

import Link from "next/link";
import { ArrowRight, Boxes, CalendarClock, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ConsumableStats } from "@/lib/types";

/**
 * #91 §4.1's consumables widget, from one `consumable_stats` call.
 *
 * The stock figures are a live snapshot; consumption and spend are month-to-date
 * on the STORE's calendar, matching the cashbook's convention rather than the
 * dashboard's date range — a monthly consumption figure that silently followed a
 * custom range would not be the monthly figure the ticket asks for.
 */
function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="rounded-[14px] border border-line-soft bg-cream px-3 py-2.5">
      <span className="block text-[11px] font-bold uppercase tracking-wide text-[#8a6a3c]">
        {label}
      </span>
      <p
        className={`num mt-1 text-[15.5px] font-bold ${
          tone === "bad" ? "text-danger" : tone === "warn" ? "text-amber-700" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function ConsumablesCard({
  loading,
  error,
  stats,
  currency,
}: {
  loading: boolean;
  error?: boolean;
  stats: ConsumableStats | null;
  currency: string;
}) {
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="flex items-center gap-1.5">
          <Boxes size={16} /> Consumables
        </h3>
        <Link
          href="/consumables"
          className="flex items-center gap-1 text-[12px] font-bold text-brown"
        >
          View <ArrowRight size={12} />
        </Link>
      </div>

      {error ? (
        <p className="py-6 text-center text-[12.5px] text-ink-muted">
          Couldn&apos;t load the stock.
        </p>
      ) : loading || !stats ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[62px] w-full rounded-[14px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Items" value={stats.totalItems} />
            <Tile
              label="Below minimum"
              value={stats.lowStock}
              tone={stats.lowStock > 0 ? "warn" : undefined}
            />
            <Tile
              label="Out of stock"
              value={stats.outOfStock}
              tone={stats.outOfStock > 0 ? "bad" : undefined}
            />
            <Tile
              label="Expiring soon"
              value={stats.expiringSoon}
              tone={stats.expiringSoon > 0 ? "warn" : undefined}
            />
          </div>

          {(stats.recommendations > 0 || stats.expired > 0) && (
            <div className="mt-2 space-y-1">
              {stats.recommendations > 0 && (
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800">
                  <TriangleAlert size={12} /> {stats.recommendations} to reorder
                </p>
              )}
              {stats.expired > 0 && (
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-danger">
                  <CalendarClock size={12} /> {stats.expired} expired with stock left
                </p>
              )}
            </div>
          )}

          <p className="mt-2 text-[11.5px] text-ink-muted">
            {currency}
            {stats.stockValue.toLocaleString("en-IN")} on the shelf · bought {currency}
            {stats.monthPurchaseCost.toLocaleString("en-IN")} this month
          </p>

          {stats.mostUsed.length > 0 && (
            <p className="mt-1 truncate text-[11.5px] text-ink-muted">
              Most used:{" "}
              {stats.mostUsed
                .slice(0, 3)
                .map((m) => `${m.name} (${m.qty} ${m.unit})`)
                .join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
