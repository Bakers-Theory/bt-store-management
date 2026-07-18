"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Users, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { fetchCustomers } from "@/lib/supabase-data";
import { initials, relativeDay } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { CustomerModal } from "./CustomerModal";
import type { Customer } from "@/lib/types";

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

  // Default sort: highest lifetime spend first.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }, [customers, search]);

  return (
    <>
      <div className="mb-3.5 relative min-w-[200px] max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
        <input
          type="text"
          placeholder="Search by name or phone…"
          className="w-full pl-9 pr-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-light hover:bg-cream hover:text-ink-muted"
          >
            <X size={15} />
          </button>
        )}
      </div>

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
            {customers.length === 0 ? "No customers yet" : "No customers match your search"}
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

      {selected && <CustomerModal customer={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
