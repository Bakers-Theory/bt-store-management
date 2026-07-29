"use client";

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

const selectCls =
  "rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown";

export function SupplierFilters({
  search,
  onSearch,
  filters,
  onFilters,
}: {
  search: string;
  onSearch: (v: string) => void;
  filters: SupplierFilterState;
  onFilters: (f: SupplierFilterState) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-light" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, code or city"
          className="w-full rounded-[11px] border border-line bg-cream py-[11px] pl-10 pr-9 text-sm outline-none focus:border-brown"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-light"
          >
            <X size={16} />
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
    </div>
  );
}
