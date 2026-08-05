"use client";

import Link from "next/link";
import { ArrowRight, Laptop, ShieldAlert, Wrench } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { AssetStats } from "@/lib/types";

/**
 * #91 §4.1's asset widget. Every figure comes from one `asset_stats` call, so no
 * two tiles here can disagree, and each links into the register behind it.
 *
 * A live snapshot, deliberately NOT range-scoped: "3 assets under repair" is a
 * fact about now, and filtering it by the dashboard's date range would answer a
 * question nobody asked.
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

export function AssetsCard({
  loading,
  error,
  stats,
  currency,
}: {
  loading: boolean;
  error?: boolean;
  stats: AssetStats | null;
  currency: string;
}) {
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="flex items-center gap-1.5">
          <Laptop size={16} /> Assets
        </h3>
        <Link href="/assets" className="flex items-center gap-1 text-[12px] font-bold text-brown">
          View <ArrowRight size={12} />
        </Link>
      </div>

      {error ? (
        <p className="py-6 text-center text-[12.5px] text-ink-muted">
          Couldn&apos;t load the assets.
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
            <Tile label="Total" value={stats.total} />
            <Tile label="Assigned" value={stats.assigned} />
            <Tile label="Available" value={stats.available} />
            <Tile
              label="Out of service"
              value={stats.underRepair + stats.maintenance}
              tone={stats.underRepair + stats.maintenance > 0 ? "warn" : undefined}
            />
          </div>

          {/* Only the two things that need doing get a line of their own. */}
          {(stats.maintenanceDue > 0 || stats.warrantyExpiring > 0) && (
            <div className="mt-2 space-y-1">
              {stats.maintenanceDue > 0 && (
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800">
                  <Wrench size={12} /> {stats.maintenanceDue} due for service
                </p>
              )}
              {stats.warrantyExpiring > 0 && (
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800">
                  <ShieldAlert size={12} /> {stats.warrantyExpiring} warranty ending soon
                </p>
              )}
            </div>
          )}

          <p className="mt-2 text-[11.5px] text-ink-muted">
            {currency}
            {stats.totalValue.toLocaleString("en-IN")} at purchase price
            {stats.lost + stats.damaged > 0 &&
              ` · ${stats.lost} lost, ${stats.damaged} damaged`}
          </p>
        </>
      )}
    </div>
  );
}
