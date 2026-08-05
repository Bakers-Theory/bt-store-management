"use client";

import { ChevronRight, Archive, Wrench, ShieldAlert } from "lucide-react";
import { assetStatusLabel, assetStatusTone, serviceStatus, warrantyStatus } from "@/lib/asset";
import type { Asset } from "@/lib/types";

const toneCls = {
  good: "bg-green-100 text-green-800",
  info: "bg-blue-100 text-blue-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
  muted: "bg-[#f3e6d2] text-[#8a6a3c]",
} as const;

export function AssetList({
  assets,
  onOpen,
  /** Selection mode, for bulk assignment (§7). Absent = plain list. */
  selected,
  onToggleSelect,
}: {
  assets: Asset[];
  onOpen: (a: Asset) => void;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const selecting = !!selected && !!onToggleSelect;
  if (assets.length === 0) {
    return (
      <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center">
        <p className="text-sm font-semibold text-ink">No assets</p>
        <p className="mt-1 text-xs text-ink-muted">Nothing matches these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      {assets.map((a) => {
        const service = serviceStatus(a.serviceDaysLeft);
        const warranty = warrantyStatus(a.warrantyDaysLeft);
        return (
          <div
            key={a.id}
            className={`flex w-full items-center gap-3 border-t border-line-soft px-5 py-3.5 first:border-t-0 hover:bg-[#faf4ea] ${
              a.isArchived || a.status === "retired" ? "opacity-60" : ""
            }`}
          >
            {selecting && (
              <input
                type="checkbox"
                aria-label={`Select ${a.code}`}
                // Only an available, unarchived asset can be issued, so nothing
                // else is selectable — the alternative is a bulk action that
                // half-fails by design.
                disabled={a.status !== "available" || a.isArchived}
                checked={selected!.has(a.id)}
                onChange={() => onToggleSelect!(a.id)}
                className="h-4 w-4 shrink-0 accent-brown"
              />
            )}
            <button
              onClick={() => onOpen(a)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink">
                {a.name}
                <span className="ml-1.5 font-normal text-ink-muted">{a.code}</span>
                {a.isArchived && (
                  <Archive size={12} className="ml-1.5 inline text-[#8a6a3c]" />
                )}
              </p>
              <p className="truncate text-[11px] text-ink-muted">
                {a.category}
                {a.location && ` · ${a.location}`}
                {a.assignedToName && ` · with ${a.assignedToName}`}
                {a.serialNumber && ` · ${a.serialNumber}`}
              </p>
            </div>

            {/* Only the states that need action earn an icon — a healthy asset
                should read as quiet. */}
            {(service === "due" || service === "overdue") && (
              <Wrench
                size={14}
                aria-label={service === "overdue" ? "Service overdue" : "Service due"}
                className={`shrink-0 ${service === "overdue" ? "text-red-600" : "text-amber-600"}`}
              />
            )}
            {warranty === "expiring" && (
              <ShieldAlert
                size={14}
                aria-label="Warranty ending"
                className="shrink-0 text-amber-600"
              />
            )}

            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                toneCls[assetStatusTone(a.status)]
              }`}
            >
              {assetStatusLabel(a.status)}
            </span>
            <ChevronRight size={15} className="shrink-0 text-[#c0a880]" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
