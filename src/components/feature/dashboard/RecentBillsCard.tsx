"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate, initials } from "@/lib/format";
import type { DashboardStats } from "@/lib/supabase-data";

export function RecentBillsCard({
  loading,
  recent,
  currency,
  onView,
}: {
  loading: boolean;
  recent: DashboardStats["recentBills"];
  currency: string;
  onView: (id: string) => void;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>Recent Bills</h3>
      </div>
      {loading ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-b-0">
            <Skeleton className="h-9 w-9 rounded-[10px]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-8 w-14" />
          </div>
        ))
      ) : recent.length === 0 ? (
        <div className="p-5 text-center text-sm text-ink-muted">No bills yet</div>
      ) : (
        recent.map((b) => (
          <div
            key={b.id}
            className={`flex items-center gap-3 border-b border-line-soft py-2.5 last:border-b-0 ${
              b.status === "cancelled" ? "opacity-[0.55]" : ""
            }`}
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-line-soft text-[13px] font-bold text-brown">
              {initials(b.customerName || "Walk-in")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">
                {b.customerName || "Walk-in"}{" "}
                {b.status === "cancelled" && <span className="badge badge-danger">Cancelled</span>}
              </div>
              <div className="text-[11.5px] text-ink-light">
                #{b.billNo} · {formatDate(b.date)}
              </div>
            </div>
            <div className="text-right">
              <div
                className={`num text-[14px] font-extrabold ${b.status === "cancelled" ? "line-through" : ""}`}
              >
                {currency}
                {b.total.toFixed(2)}
              </div>
              <button className="btn-sm btn-secondary mt-1" onClick={() => onView(b.id)}>
                View
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
