"use client";

import { Search, X } from "lucide-react";
import { stockStatusLabel } from "@/lib/consumable";
import type { StockStatus } from "@/lib/types";

const STATUSES: StockStatus[] = ["out", "low", "reorder", "ok"];

export interface ConsumableFilterState {
  q: string;
  category: string;
  stockStatus: StockStatus | "";
  expiry: "" | "expiring" | "expired";
}

export const DEFAULT_CONSUMABLE_FILTERS: ConsumableFilterState = {
  q: "",
  category: "",
  stockStatus: "",
  expiry: "",
};

const selectCls =
  "rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-semibold text-ink";

const isDefault = (f: ConsumableFilterState) =>
  f.q === "" && f.category === "" && f.stockStatus === "" && f.expiry === "";

export function ConsumableFilters({
  value,
  categories,
  onChange,
}: {
  value: ConsumableFilterState;
  categories: string[];
  onChange: (f: ConsumableFilterState) => void;
}) {
  const set = <K extends keyof ConsumableFilterState>(
    k: K,
    v: ConsumableFilterState[K],
  ) => onChange({ ...value, [k]: v });

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
          placeholder="Item, code, vendor or storage place"
          aria-label="Search consumables"
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
          value={value.stockStatus}
          onChange={(e) => set("stockStatus", e.target.value as StockStatus | "")}
          aria-label="Stock level"
          className={selectCls}
        >
          <option value="">Any level</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {stockStatusLabel(s)}
            </option>
          ))}
        </select>

        <select
          value={value.expiry}
          onChange={(e) =>
            set("expiry", e.target.value as ConsumableFilterState["expiry"])
          }
          aria-label="Expiry"
          className={selectCls}
        >
          <option value="">Any expiry</option>
          <option value="expiring">Expiring soon</option>
          <option value="expired">Already expired</option>
        </select>

        {!isDefault(value) && (
          <button
            onClick={() => onChange(DEFAULT_CONSUMABLE_FILTERS)}
            className="inline-flex items-center gap-1 rounded-[11px] border border-line bg-cream px-2.5 py-2 text-xs font-bold text-[#8a6a3c]"
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
