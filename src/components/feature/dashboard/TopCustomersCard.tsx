"use client";

import { Users } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Customer } from "@/lib/types";

export function TopCustomersCard({
  loaded,
  error,
  customers,
  currency,
}: {
  loaded: boolean;
  error: boolean;
  customers: Customer[];
  currency: string;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="flex items-center gap-1.5">
          <Users size={16} /> Top customers
        </h3>
      </div>
      {!loaded ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-12" />
          </div>
        ))
      ) : error ? (
        <div className="p-3 text-center text-[12.5px] text-danger">Couldn&apos;t load customers</div>
      ) : customers.length === 0 ? (
        <div className="p-3 text-center text-[12.5px] text-ink-muted">No customers yet</div>
      ) : (
        customers.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-line-soft text-[12px] font-bold text-brown">
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-bold text-ink">{c.name || c.phone}</div>
              <div className="text-[11.5px] text-ink-light">
                {c.visitCount} visit{c.visitCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="num text-[14px] font-extrabold text-ink">
              {currency}
              {c.totalSpend.toFixed(0)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
