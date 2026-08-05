"use client";

import { Search, X } from "lucide-react";
import { ASSET_STATUSES, assetStatusLabel } from "@/lib/asset";
import type { AssetStatus, Employee } from "@/lib/types";

/**
 * #91 §4.4's filters over the register. The empty string is the "any" sentinel
 * throughout — `Assets.tsx` strips those before querying, so a filter is either
 * a real value or absent from the query altogether.
 */
export interface AssetFilterState {
  q: string;
  category: string;
  status: AssetStatus | "";
  employeeId: string;
  warranty: "" | "expiring" | "expired";
  serviceDue: boolean;
  includeArchived: boolean;
}

export const DEFAULT_ASSET_FILTERS: AssetFilterState = {
  q: "",
  category: "",
  status: "",
  employeeId: "",
  warranty: "",
  serviceDue: false,
  includeArchived: false,
};

const selectCls =
  "rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-semibold text-ink";

const isDefault = (f: AssetFilterState) =>
  f.q === "" &&
  f.category === "" &&
  f.status === "" &&
  f.employeeId === "" &&
  f.warranty === "" &&
  !f.serviceDue &&
  !f.includeArchived;

export function AssetFilters({
  value,
  categories,
  holders,
  onChange,
}: {
  value: AssetFilterState;
  categories: string[];
  holders: Employee[];
  onChange: (f: AssetFilterState) => void;
}) {
  const set = <K extends keyof AssetFilterState>(k: K, v: AssetFilterState[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-2 rounded-[18px] border border-line bg-warm-white p-3 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#c0a880]"
        />
        <input
          value={value.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Code, name, serial number or who has it"
          aria-label="Search assets"
          className="w-full rounded-[11px] border border-line bg-cream py-2.5 pl-9 pr-3 text-sm text-ink outline-none focus:border-brown"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={value.category}
          onChange={(e) => set("category", e.target.value)}
          aria-label="Category"
          className={selectCls}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={value.status}
          onChange={(e) => set("status", e.target.value as AssetStatus | "")}
          aria-label="Status"
          className={selectCls}
        >
          <option value="">Any status</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {assetStatusLabel(s)}
            </option>
          ))}
        </select>

        <select
          value={value.employeeId}
          onChange={(e) => set("employeeId", e.target.value)}
          aria-label="Held by"
          className={selectCls}
        >
          <option value="">Anyone</option>
          {holders.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>

        <select
          value={value.warranty}
          onChange={(e) => set("warranty", e.target.value as AssetFilterState["warranty"])}
          aria-label="Warranty"
          className={selectCls}
        >
          <option value="">Any warranty</option>
          <option value="expiring">Ending soon</option>
          <option value="expired">Already expired</option>
        </select>

        <label className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-semibold text-ink">
          <input
            type="checkbox"
            checked={value.serviceDue}
            onChange={(e) => set("serviceDue", e.target.checked)}
          />
          Service due
        </label>

        <label className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-semibold text-ink">
          <input
            type="checkbox"
            checked={value.includeArchived}
            onChange={(e) => set("includeArchived", e.target.checked)}
          />
          Show archived
        </label>

        {!isDefault(value) && (
          <button
            onClick={() => onChange(DEFAULT_ASSET_FILTERS)}
            className="inline-flex items-center gap-1 rounded-[11px] border border-line bg-cream px-2.5 py-2 text-xs font-bold text-[#8a6a3c]"
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
