"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Truck } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { fetchSuppliers } from "@/lib/supabase-data";
import { supplierTypeLabel } from "@/lib/supplier";
import { initials } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  DEFAULT_SUPPLIER_FILTERS,
  SupplierFilters,
  type SupplierFilterState,
} from "./SupplierFilters";
import { SupplierModal } from "./SupplierModal";
import { SupplierDetail } from "./SupplierDetail";
import type { Supplier } from "@/lib/types";

const ListSkeleton = () => (
  <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
        <Skeleton className="h-[42px] w-[42px] rounded-[11px]" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-4 w-16" />
      </div>
    ))}
  </div>
);

export function Suppliers() {
  const user = useCurrentUser();
  const canCreate = hasPermission(user, "suppliers.create");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<SupplierFilterState>(DEFAULT_SUPPLIER_FILTERS);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => setRetryToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setError(false);
    fetchSuppliers()
      .then((rows) => {
        if (!alive) return;
        setSuppliers(rows);
        setLoaded(true);
        // Keep an open detail pane in step with the refreshed list.
        setSelected((cur) => (cur ? rows.find((r) => r.id === cur.id) ?? null : null));
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (filters.status !== "all" && s.status !== filters.status) return false;
      if (filters.type !== "all" && s.supplierType !== filters.type) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q)
      );
    });
  }, [suppliers, search, filters]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {loaded ? `${visible.length} of ${suppliers.length}` : "Loading…"}
        </p>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border-none bg-brown px-4 py-2.5 text-sm font-bold text-warm-white"
          >
            <Plus size={16} /> Add supplier
          </button>
        )}
      </div>

      <SupplierFilters search={search} onSearch={setSearch} filters={filters} onFilters={setFilters} />

      {!loaded ? (
        <ListSkeleton />
      ) : error ? (
        <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-sm text-ink-muted">
          Couldn&apos;t load suppliers.{" "}
          <button type="button" className="font-bold text-brown underline" onClick={reload}>
            Retry
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-warm-white px-5 py-[60px] text-center text-ink-muted">
          <div className="mb-3 flex justify-center"><Truck size={44} /></div>
          <p className="text-sm">
            {suppliers.length === 0 ? "No suppliers yet." : "No suppliers match your filters."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s)}
              className="flex w-full items-center gap-3.5 border-t border-line-soft px-5 py-3.5 text-left first:border-t-0 hover:bg-cream/60"
            >
              <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-cream-dark text-sm font-bold text-brown">
                {initials(s.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-ink">{s.name}</div>
                <div className="truncate text-[12px] font-semibold text-ink-light">
                  {s.code} · {supplierTypeLabel(s.supplierType)}
                  {s.city ? ` · ${s.city}` : ""}
                </div>
              </div>
              {s.status === "inactive" && (
                <span className="shrink-0 rounded-full bg-cream px-2.5 py-1 text-[11px] font-bold text-ink-muted">
                  Inactive
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {creating && (
        <SupplierModal
          supplier={null}
          onClose={() => setCreating(false)}
          onSaved={reload}
        />
      )}
      {selected && (
        <SupplierDetail
          supplier={selected}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}
