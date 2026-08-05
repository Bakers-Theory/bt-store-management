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

// The app's filter idiom (see ExpenseFilters): a labelled grid, because
// globals.css gives every `select` `width: 100%` — in a flex row each one takes
// a line of its own. `min-w-0` is what lets a control shrink inside its cell.
const fieldCls = "min-w-0";
const labelCls = "mb-1 block text-[11px] font-bold text-[#8a6a3c]";
const controlCls = "!py-2 !text-[13px] font-semibold";
// A bare checkbox inherits that same `width: 100%` plus the 10px control
// padding, which squeezes its label onto two lines. Sizing it explicitly is how
// the rest of the app opts out.
const checkCls = "h-4 w-4 shrink-0 accent-brown";

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

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <div className={fieldCls}>
          <label className={labelCls} htmlFor="asf-cat">Category</label>
          <select
            id="asf-cat"
            value={value.category}
            onChange={(e) => set("category", e.target.value)}
            className={controlCls}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className={fieldCls}>
          <label className={labelCls} htmlFor="asf-status">Status</label>
          <select
            id="asf-status"
            value={value.status}
            onChange={(e) => set("status", e.target.value as AssetStatus | "")}
            className={controlCls}
          >
            <option value="">Any status</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {assetStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>

        <div className={fieldCls}>
          <label className={labelCls} htmlFor="asf-holder">Held by</label>
          <select
            id="asf-holder"
            value={value.employeeId}
            onChange={(e) => set("employeeId", e.target.value)}
            className={controlCls}
          >
            <option value="">Anyone</option>
            {holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>

        <div className={fieldCls}>
          <label className={labelCls} htmlFor="asf-warranty">Warranty</label>
          <select
            id="asf-warranty"
            value={value.warranty}
            onChange={(e) => set("warranty", e.target.value as AssetFilterState["warranty"])}
            className={controlCls}
          >
            <option value="">Any warranty</option>
            <option value="expiring">Ending soon</option>
            <option value="expired">Already expired</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-[12.5px] font-semibold text-ink">
          <input
            type="checkbox"
            className={checkCls}
            checked={value.serviceDue}
            onChange={(e) => set("serviceDue", e.target.checked)}
          />
          Service due
        </label>

        <label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-[12.5px] font-semibold text-ink">
          <input
            type="checkbox"
            className={checkCls}
            checked={value.includeArchived}
            onChange={(e) => set("includeArchived", e.target.checked)}
          />
          Show archived
        </label>

        {!isDefault(value) && (
          <button
            onClick={() => onChange(DEFAULT_ASSET_FILTERS)}
            className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-[11px] border border-line bg-cream px-2.5 py-2 text-[12.5px] font-bold text-[#8a6a3c]"
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
