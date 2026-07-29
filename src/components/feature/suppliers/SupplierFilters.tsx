"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { SupplierStatus, SupplierType } from "@/lib/types";

export interface SupplierFilterState {
  status: SupplierStatus | "all";
  type: SupplierType | "all";
}

export const DEFAULT_SUPPLIER_FILTERS: SupplierFilterState = {
  // Inactive suppliers are history, not working data — hidden until asked for.
  status: "active",
  type: "all",
};

// `!w-auto` is load-bearing: globals.css sets `select { width: 100% }`, which
// inside a flex row would let each select eat the search field's space.
const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

export function SupplierFilters({
  search,
  onSearch,
  filters,
  onFilters,
  action,
}: {
  search: string;
  onSearch: (v: string) => void;
  filters: SupplierFilterState;
  onFilters: (f: SupplierFilterState) => void;
  /** Trailing toolbar slot — the Add supplier button, when the user may create. */
  action?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[200px] flex-1">
        <span className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-ink-light">
          <Search size={16} />
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, code or city…"
          className="w-full rounded-xl border border-line bg-warm-white py-[11px] pl-[38px] pr-10 text-sm outline-none"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onSearch("")}
            className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-light hover:bg-cream hover:text-ink-muted"
          >
            <X size={15} />
          </button>
        )}
      </div>
      <select
        aria-label="Status"
        className={selectCls}
        value={filters.status}
        onChange={(e) =>
          onFilters({ ...filters, status: e.target.value as SupplierFilterState["status"] })
        }
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="all">All statuses</option>
      </select>
      <select
        aria-label="Supplier type"
        className={selectCls}
        value={filters.type}
        onChange={(e) =>
          onFilters({ ...filters, type: e.target.value as SupplierFilterState["type"] })
        }
      >
        <option value="all">All types</option>
        <option value="external">External</option>
        <option value="in_house">In-house</option>
      </select>
      {action}
    </div>
  );
}
