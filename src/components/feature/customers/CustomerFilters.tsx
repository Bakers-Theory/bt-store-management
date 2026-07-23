"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

// ── Filter model ──────────────────────────────────────────────────────────
export type SortKey = "spend" | "visits" | "recent" | "lapsed";
export type ActivityFilter = "all" | "active" | "lapsed30" | "lapsed60" | "lapsed90";
export type SpendTier = "all" | "high" | "mid" | "low";
export type VisitFilter = "all" | "new" | "repeat";

export interface CustomerFilterState {
  sort: SortKey;
  activity: ActivityFilter;
  spend: SpendTier;
  visits: VisitFilter;
}

export const DEFAULT_FILTERS: CustomerFilterState = {
  sort: "spend",
  activity: "all",
  spend: "all",
  visits: "all",
};

/** Count of active (non-"all") filters — sort is not a filter. */
export function filterCount(f: CustomerFilterState): number {
  return (f.activity !== "all" ? 1 : 0) + (f.spend !== "all" ? 1 : 0) + (f.visits !== "all" ? 1 : 0);
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "spend", label: "Highest spend" },
  { value: "visits", label: "Most visits" },
  { value: "recent", label: "Recently visited" },
  { value: "lapsed", label: "Longest since visit" },
];

const ACTIVITY_OPTIONS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "lapsed30", label: "Lapsed 30d" },
  { value: "lapsed60", label: "Lapsed 60d" },
  { value: "lapsed90", label: "Lapsed 90d" },
];
const SPEND_OPTIONS: { value: SpendTier; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "mid", label: "Mid" },
  { value: "low", label: "Low" },
];
const VISIT_OPTIONS: { value: VisitFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New (1)" },
  { value: "repeat", label: "Repeat (2+)" },
];

// Labels for the removable "active filter" chips shown beneath the controls.
const ACTIVITY_CHIP: Record<Exclude<ActivityFilter, "all">, string> = {
  active: "Active",
  lapsed30: "Lapsed 30d",
  lapsed60: "Lapsed 60d",
  lapsed90: "Lapsed 90d",
};
const SPEND_CHIP: Record<Exclude<SpendTier, "all">, string> = {
  high: "High spend",
  mid: "Mid spend",
  low: "Low spend",
};
const VISIT_CHIP: Record<Exclude<VisitFilter, "all">, string> = {
  new: "New",
  repeat: "Repeat",
};

// ── Styling (mirrors History.tsx) ─────────────────────────────────────────
const chipCls = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-[15px] py-[7px] text-[13px] font-bold transition-colors ${
    active ? "border-brown bg-brown text-warm-white" : "border-line bg-warm-white text-ink-muted"
  }`;

const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

function FilterRow<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-[12px] font-bold uppercase tracking-wide text-ink-light">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onSelect(o.value)}
          className={chipCls(value === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CustomerFilters({
  search,
  onSearch,
  filters,
  onFilters,
}: {
  search: string;
  onSearch: (v: string) => void;
  filters: CustomerFilterState;
  onFilters: (f: CustomerFilterState) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const count = filterCount(filters);

  const set = (patch: Partial<CustomerFilterState>) => onFilters({ ...filters, ...patch });
  const clearFilters = () => onFilters({ ...filters, activity: "all", spend: "all", visits: "all" });

  return (
    <div className="mb-3.5">
      {/* Row 1: search + sort + filters toggle */}
      <div className="mb-2.5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
          <input
            type="text"
            placeholder="Search by name or phone…"
            className="w-full pl-9 pr-9"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-light hover:bg-cream hover:text-ink-muted"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <select
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value as SortKey })}
          aria-label="Sort customers"
          className={selectCls}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-[11px] text-[13.5px] font-bold transition-colors ${
            panelOpen || count > 0
              ? "border-brown bg-cream-dark text-brown"
              : "border-line bg-warm-white text-ink-muted"
          }`}
        >
          <SlidersHorizontal size={15} />
          Filters
          {count > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brown px-1 text-[11px] font-bold text-warm-white">
              {count}
            </span>
          )}
        </button>
      </div>

      {/* Filters panel */}
      {panelOpen && (
        <div className="mb-2.5 space-y-3 rounded-[14px] border border-line bg-warm-white p-4 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          <FilterRow
            label="Activity"
            value={filters.activity}
            options={ACTIVITY_OPTIONS}
            onSelect={(v) => set({ activity: v })}
          />
          <FilterRow
            label="Spend"
            value={filters.spend}
            options={SPEND_OPTIONS}
            onSelect={(v) => set({ spend: v })}
          />
          <FilterRow
            label="Visits"
            value={filters.visits}
            options={VISIT_OPTIONS}
            onSelect={(v) => set({ visits: v })}
          />
        </div>
      )}

      {/* Active-filter chips */}
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.activity !== "all" && (
            <ActiveChip label={ACTIVITY_CHIP[filters.activity]} onRemove={() => set({ activity: "all" })} />
          )}
          {filters.spend !== "all" && (
            <ActiveChip label={SPEND_CHIP[filters.spend]} onRemove={() => set({ spend: "all" })} />
          )}
          {filters.visits !== "all" && (
            <ActiveChip label={VISIT_CHIP[filters.visits]} onRemove={() => set({ visits: "all" })} />
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="text-[12.5px] font-bold text-ink-light underline underline-offset-2 hover:text-ink-muted"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-brown bg-cream-dark py-[5px] pl-3 pr-1.5 text-[12.5px] font-bold text-brown">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full hover:bg-[#e8d6ba]"
      >
        <X size={13} />
      </button>
    </span>
  );
}
