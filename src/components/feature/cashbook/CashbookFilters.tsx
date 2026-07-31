"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { CASH_PAYMENT_MODES, postableCategories } from "@/lib/cashbook";
import { ymdToDMY } from "@/lib/excel";
import type { DateRange } from "@/lib/date-range";
import type {
  CashAccount,
  CashCategory,
  CashDirection,
  CashPaymentMode,
  CashSourceType,
} from "@/lib/types";

export interface CashbookFilterState {
  range: DateRange;
  account: CashAccount | "";
  direction: CashDirection | "";
  categoryId: string;
  paymentMode: CashPaymentMode | "";
  sourceType: CashSourceType | "";
  q: string;
}

export const DEFAULT_CASHBOOK_FILTERS: CashbookFilterState = {
  range: { from: null, to: null },
  account: "",
  direction: "",
  categoryId: "",
  paymentMode: "",
  sourceType: "",
  q: "",
};

const SOURCE_TYPES: { value: CashSourceType; label: string }[] = [
  { value: "bill", label: "POS Sale" },
  { value: "manual", label: "Manual" },
  { value: "salary", label: "Salary" },
  { value: "advance", label: "Staff Advance" },
  { value: "supplier_payment", label: "Vendor Payment" },
  { value: "transfer", label: "Transfer" },
];

// `globals.css` puts `width: 100%` on every select in the BASE layer, so a
// flex row of them stacks into full-width bars no matter what utilities are
// applied. A grid is what actually constrains them — each cell owns its width
// and the select fills its cell.
const fieldCls = "min-w-0";
const labelCls = "mb-1 block text-[11px] font-bold text-[#8a6a3c]";
const selectCls = "!py-2 !text-[13px] font-semibold";

/** Which filters are set, in one place, so the count/chips/clear can't disagree. */
type Chip = { key: keyof CashbookFilterState; label: string };

export function CashbookFilters({
  value,
  categories,
  onChange,
}: {
  value: CashbookFilterState;
  categories: CashCategory[];
  onChange: (next: CashbookFilterState) => void;
}) {
  const [open, setOpen] = useState(false);

  const set = <K extends keyof CashbookFilterState>(
    key: K,
    v: CashbookFilterState[K],
  ) => onChange({ ...value, [key]: v });

  // Childless top-level categories are leaves too, so they are offered
  // alongside the grouped ones (see postableCategories).
  const { groups, flat } = useMemo(() => postableCategories(categories), [categories]);
  const system = useMemo(() => categories.filter((c) => c.isSystem), [categories]);

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
    if (value.account)
      out.push({ key: "account", label: value.account === "cash" ? "Cash" : "Bank" });
    if (value.direction)
      out.push({
        key: "direction",
        label: value.direction === "in" ? "Money in" : "Money out",
      });
    if (value.categoryId) {
      const c = categories.find((x) => x.id === value.categoryId);
      if (c) out.push({ key: "categoryId", label: c.name });
    }
    if (value.paymentMode) out.push({ key: "paymentMode", label: value.paymentMode });
    if (value.sourceType) {
      const t = SOURCE_TYPES.find((x) => x.value === value.sourceType);
      out.push({ key: "sourceType", label: t?.label ?? value.sourceType });
    }
    return out;
  }, [value, categories]);

  const clearOne = (key: keyof CashbookFilterState) =>
    onChange({
      ...value,
      ...(key === "range" ? { range: { from: null, to: null } } : { [key]: "" }),
    });

  const clearAll = () => onChange({ ...DEFAULT_CASHBOOK_FILTERS, q: value.q });

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
            placeholder="Search purpose, reference, bill or supplier"
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
          narrowed list never looks like the whole ledger. */}
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
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="cbf-account">Account</label>
              <select
                id="cbf-account"
                className={selectCls}
                value={value.account}
                onChange={(e) => set("account", e.target.value as CashAccount | "")}
              >
                <option value="">All accounts</option>
                <option value="cash">Cash in hand</option>
                <option value="bank">Bank</option>
              </select>
            </div>

            <div className={fieldCls}>
              <label className={labelCls} htmlFor="cbf-direction">Direction</label>
              <select
                id="cbf-direction"
                className={selectCls}
                value={value.direction}
                onChange={(e) => set("direction", e.target.value as CashDirection | "")}
              >
                <option value="">In and out</option>
                <option value="in">Money in</option>
                <option value="out">Money out</option>
              </select>
            </div>

            <div className={fieldCls}>
              <label className={labelCls} htmlFor="cbf-type">Type</label>
              <select
                id="cbf-type"
                className={selectCls}
                value={value.sourceType}
                onChange={(e) => set("sourceType", e.target.value as CashSourceType | "")}
              >
                <option value="">All types</option>
                {SOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={fieldCls}>
              <label className={labelCls} htmlFor="cbf-mode">Payment mode</label>
              <select
                id="cbf-mode"
                className={selectCls}
                value={value.paymentMode}
                onChange={(e) => set("paymentMode", e.target.value as CashPaymentMode | "")}
              >
                <option value="">All modes</option>
                {CASH_PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className={`${fieldCls} col-span-2 lg:col-span-1`}>
              <label className={labelCls} htmlFor="cbf-category">Category</label>
              <select
                id="cbf-category"
                className={selectCls}
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
                {system.length > 0 && (
                  <optgroup label="Automatic">
                    {system.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
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
