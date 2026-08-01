"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { postableCategories } from "@/lib/cashbook";
import { EXPENSE_MODES, EXPENSE_STATUSES, expenseStatusLabel } from "@/lib/expense";
import { ymdToDMY } from "@/lib/excel";
import type { DateRange } from "@/lib/date-range";
import type { CashCategory, ExpenseMode, ExpenseStatus } from "@/lib/types";

export interface ExpenseFilterState {
  range: DateRange;
  categoryId: string;
  vendor: string;
  minAmount: string;
  maxAmount: string;
  paymentMode: ExpenseMode | "";
  status: ExpenseStatus | "";
  q: string;
}

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilterState = {
  range: { from: null, to: null },
  categoryId: "",
  vendor: "",
  minAmount: "",
  maxAmount: "",
  paymentMode: "",
  status: "",
  q: "",
};

// `globals.css` puts `width: 100%` on every select in the BASE layer, so a flex
// row of them stacks into full-width bars. A grid is what actually constrains
// them — each cell owns its width and the control fills its cell.
const fieldCls = "min-w-0";
const labelCls = "mb-1 block text-[11px] font-bold text-[#8a6a3c]";
const controlCls = "!py-2 !text-[13px] font-semibold";

/** Which filters are set, in one place, so the count/chips/clear can't disagree. */
type Chip = { key: keyof ExpenseFilterState; label: string };

export function ExpenseFilters({
  value,
  categories,
  vendors,
  onChange,
}: {
  value: ExpenseFilterState;
  categories: CashCategory[];
  vendors: string[];
  onChange: (next: ExpenseFilterState) => void;
}) {
  const [open, setOpen] = useState(false);

  const set = <K extends keyof ExpenseFilterState>(
    key: K,
    v: ExpenseFilterState[K],
  ) => onChange({ ...value, [key]: v });

  // Only money-out categories are ever filed against. Childless top-level
  // categories are leaves too, so they are offered alongside the grouped ones
  // (see postableCategories).
  const { groups, flat } = useMemo(
    () => postableCategories(categories, "out"),
    [categories],
  );

  const chips = useMemo<Chip[]>(() => {
    const out: Chip[] = [];
    const { from, to } = value.range;
    if (from || to) {
      out.push({
        key: "range",
        label:
          from && to
            ? from === to
              ? ymdToDMY(from)
              : `${ymdToDMY(from)} – ${ymdToDMY(to)}`
            : from
              ? `From ${ymdToDMY(from)}`
              : `Up to ${ymdToDMY(to!)}`,
      });
    }
    if (value.categoryId) {
      const c = categories.find((x) => x.id === value.categoryId);
      if (c) out.push({ key: "categoryId", label: c.name });
    }
    if (value.vendor) out.push({ key: "vendor", label: value.vendor });
    if (value.status)
      out.push({ key: "status", label: expenseStatusLabel(value.status) });
    if (value.paymentMode) out.push({ key: "paymentMode", label: value.paymentMode });
    if (value.minAmount) out.push({ key: "minAmount", label: `Min ${value.minAmount}` });
    if (value.maxAmount) out.push({ key: "maxAmount", label: `Max ${value.maxAmount}` });
    return out;
  }, [value, categories]);

  const clearOne = (key: keyof ExpenseFilterState) =>
    onChange({
      ...value,
      ...(key === "range" ? { range: { from: null, to: null } } : { [key]: "" }),
    });

  const clearAll = () => onChange({ ...DEFAULT_EXPENSE_FILTERS, q: value.q });

  return (
    <div className="space-y-2.5">
      {/* Search is the most-used control, so it never hides behind a toggle. */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a6a3c]"
          />
          <input
            value={value.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search expense no, vendor, invoice or description"
            className="!pl-9"
          />
          {value.q && (
            <button
              onClick={() => set("q", "")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#8a6a3c] hover:bg-[#f6ecdd]"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-[12px] border px-3 text-xs font-bold ${
            open || chips.length
              ? "border-brown bg-brown text-white"
              : "border-line bg-warm-white text-ink"
          }`}
        >
          <SlidersHorizontal size={14} />
          <span className="hidden sm:inline">Filters</span>
          {chips.length > 0 && (
            <span
              className={`rounded-full px-1.5 text-[10px] leading-4 ${
                open || chips.length ? "bg-white/25" : "bg-[#f3e6d2]"
              }`}
            >
              {chips.length}
            </span>
          )}
        </button>
      </div>

      {/* Collapsed but filtered is the dangerous state — the chips make sure a
          narrowed list never looks like the whole register. */}
      {!open && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => clearOne(c.key)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-warm-white py-1 pl-2.5 pr-1.5 text-[11px] font-semibold text-ink"
            >
              {c.label}
              <X size={11} className="text-[#8a6a3c]" />
            </button>
          ))}
          <button
            onClick={clearAll}
            className="px-1.5 text-[11px] font-bold text-[#8a6a3c] underline"
          >
            Clear all
          </button>
        </div>
      )}

      {open && (
      <div className="space-y-3 rounded-[16px] border border-line bg-warm-white p-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <DateRangePicker value={value.range} onChange={(r) => set("range", r)} />

        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          <div className={`${fieldCls} col-span-2 lg:col-span-1`}>
            <label className={labelCls} htmlFor="exf-category">Category</label>
            <select
              id="exf-category"
              className={controlCls}
              value={value.categoryId}
              onChange={(e) => set("categoryId", e.target.value)}
            >
              <option value="">All categories</option>
              {flat.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.leaves.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className={fieldCls}>
            <label className={labelCls} htmlFor="exf-vendor">Vendor</label>
            <select
              id="exf-vendor"
              className={controlCls}
              value={value.vendor}
              onChange={(e) => set("vendor", e.target.value)}
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className={fieldCls}>
            <label className={labelCls} htmlFor="exf-status">Status</label>
            <select
              id="exf-status"
              className={controlCls}
              value={value.status}
              onChange={(e) => set("status", e.target.value as ExpenseStatus | "")}
            >
              <option value="">All statuses</option>
              {EXPENSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {expenseStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div className={fieldCls}>
            <label className={labelCls} htmlFor="exf-mode">Payment mode</label>
            <select
              id="exf-mode"
              className={controlCls}
              value={value.paymentMode}
              onChange={(e) => set("paymentMode", e.target.value as ExpenseMode | "")}
            >
              <option value="">All modes</option>
              {EXPENSE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className={fieldCls}>
            <label className={labelCls} htmlFor="exf-min">Min amount</label>
            <input
              id="exf-min"
              type="number"
              min="0"
              inputMode="decimal"
              placeholder="Min"
              className={controlCls}
              value={value.minAmount}
              onChange={(e) => set("minAmount", e.target.value)}
            />
          </div>

          <div className={fieldCls}>
            <label className={labelCls} htmlFor="exf-max">Max amount</label>
            <input
              id="exf-max"
              type="number"
              min="0"
              inputMode="decimal"
              placeholder="Max"
              className={controlCls}
              value={value.maxAmount}
              onChange={(e) => set("maxAmount", e.target.value)}
            />
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex items-center justify-between border-t border-line-soft pt-2.5">
            <span className="text-[11px] text-ink-muted">
              {chips.length} filter{chips.length === 1 ? "" : "s"} applied
            </span>
            <button
              onClick={clearAll}
              className="text-[11px] font-bold text-[#8a6a3c] underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
