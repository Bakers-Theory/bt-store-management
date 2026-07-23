"use client";

import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { fetchCustomers } from "@/lib/supabase-data";
import { initials, relativeDay } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { CustomerModal } from "./CustomerModal";
import {
  CustomerFilters,
  DEFAULT_FILTERS,
  type CustomerFilterState,
  type SpendTier,
} from "./CustomerFilters";
import type { Customer } from "@/lib/types";

const DAY_MS = 86_400_000;

// Rank customers into spend terciles (High/Mid/Low) by position, so buckets
// stay balanced regardless of the actual amounts. Zero-spend customers land in
// Low. Computed over the whole loaded set — independent of the active filters.
function spendTiers(customers: Customer[]): Map<string, SpendTier> {
  const ranked = [...customers].sort((a, b) => b.totalSpend - a.totalSpend);
  const third = Math.ceil(ranked.length / 3);
  const map = new Map<string, SpendTier>();
  ranked.forEach((c, i) => {
    map.set(c.id, i < third ? "high" : i < third * 2 ? "mid" : "low");
  });
  return map;
}

const ListSkeleton = () => (
  <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
        <Skeleton className="h-[42px] w-[42px] rounded-[11px]" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-16" />
      </div>
    ))}
  </div>
);

export function Customers() {
  const currency = useBakeryStore((s) => s.bakery.currency);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<CustomerFilterState>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Customer | null>(null);

  useEffect(() => {
    let alive = true;
    setError(false);
    fetchCustomers()
      .then((rows) => {
        if (!alive) return;
        setCustomers(rows);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setLoaded(true);
        setError(true);
      });
    return () => {
      alive = false;
    };
  }, [retryToken]);

  const tiers = useMemo(() => spendTiers(customers), [customers]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date().getTime();
    // Days since last purchase; never-visited → Infinity (treated as lapsed).
    const daysSince = (iso: string | null) => (iso ? (now - new Date(iso).getTime()) / DAY_MS : Infinity);

    const rows = customers.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.phone.includes(q)) return false;

      const days = daysSince(c.lastPurchase);
      if (filters.activity === "active" && days > 30) return false;
      if (filters.activity === "lapsed30" && days <= 30) return false;
      if (filters.activity === "lapsed60" && days <= 60) return false;
      if (filters.activity === "lapsed90" && days <= 90) return false;

      if (filters.spend !== "all" && tiers.get(c.id) !== filters.spend) return false;

      if (filters.visits === "new" && c.visitCount !== 1) return false;
      if (filters.visits === "repeat" && c.visitCount < 2) return false;

      return true;
    });

    return rows.sort((a, b) => {
      switch (filters.sort) {
        case "visits":
          return b.visitCount - a.visitCount;
        case "recent": // most recent first (never-visited last)
          return daysSince(a.lastPurchase) - daysSince(b.lastPurchase);
        case "lapsed": // longest since visit first (never-visited first)
          return daysSince(b.lastPurchase) - daysSince(a.lastPurchase);
        default:
          return b.totalSpend - a.totalSpend;
      }
    });
  }, [customers, search, filters, tiers]);

  return (
    <>
      <CustomerFilters search={search} onSearch={setSearch} filters={filters} onFilters={setFilters} />

      {!loaded ? (
        <ListSkeleton />
      ) : error ? (
        <div className="px-5 py-10 text-center text-ink-muted">
          <div className="mb-3 flex justify-center">
            <Users size={48} />
          </div>
          <p className="mb-3 text-sm">Couldn&apos;t load customers.</p>
          <button
            type="button"
            onClick={() => setRetryToken((t) => t + 1)}
            className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
          >
            Retry
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="px-5 py-10 text-center text-ink-muted">
          <div className="mb-3 flex justify-center">
            <Users size={48} />
          </div>
          <p className="text-sm">
            {customers.length === 0 ? "No customers yet" : "No customers match your filters"}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="flex w-full items-center gap-3.5 border-t border-line-soft px-5 py-3.5 text-left transition-colors first:border-t-0 hover:bg-cream"
            >
              <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#f4e7d2] text-[13px] font-bold text-brown">
                {initials(c.name, "#")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-ink">{c.name || "Unnamed"}</div>
                <div className="text-xs text-ink-light">
                  {c.phone} · {c.visitCount} visit{c.visitCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[15px] font-extrabold text-ink">
                  {currency}
                  {c.totalSpend.toFixed(2)}
                </div>
                <div className="text-[11px] text-ink-light">
                  {c.lastPurchase ? relativeDay(c.lastPurchase) : "No visits"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <CustomerModal
          customer={selected}
          onClose={() => setSelected(null)}
          onUpdated={(u) => {
            setSelected(u);
            setCustomers((prev) => prev.map((c) => (c.id === u.id ? u : c)));
          }}
        />
      )}
    </>
  );
}
