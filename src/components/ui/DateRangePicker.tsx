"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { presets, rangeLabel, type DateRange } from "@/lib/date-range";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown disabled:opacity-50";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";
const pillBase =
  "shrink-0 rounded-full border px-2.5 py-1 my-1 text-xs font-semibold transition-colors";
const pillOn = "border-brown bg-cream text-brown";
const pillOff = "border-line bg-cream text-ink-muted hover:border-brown hover:text-brown";

/** One-line, horizontally-scrolling row of preset pills (incl. "All time"). */
function PresetPills({
  value,
  onPick,
}: {
  value: DateRange;
  onPick: (r: DateRange) => void;
}) {
  const isActive = (from: string | null, to: string | null) =>
    value.from === from && value.to === to;

  return (
    <div className="flex min-w-0 gap-1.5 overflow-x-auto">
      {presets().map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => onPick({ from: p.from, to: p.to })}
          className={`${pillBase} ${isActive(p.from, p.to) ? pillOn : pillOff}`}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPick({ from: null, to: null })}
        className={`${pillBase} ${isActive(null, null) ? pillOn : pillOff}`}
      >
        All time
      </button>
    </div>
  );
}

/** Custom From/To date inputs. */
function CustomRange({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className={labelCls} htmlFor="dr-from">From</label>
        <input
          id="dr-from"
          type="date"
          className={inputCls}
          value={value.from ?? ""}
          onChange={(e) => onChange({ ...value, from: e.target.value || null })}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="dr-to">To</label>
        <input
          id="dr-to"
          type="date"
          className={inputCls}
          value={value.to ?? ""}
          onChange={(e) => onChange({ ...value, to: e.target.value || null })}
        />
      </div>
    </div>
  );
}

/** Always-expanded inline picker (used in forms like Reports). */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  return (
    <div>
      <span className={labelCls}>Date range</span>
      <div className="mb-2.5">
        <PresetPills value={value} onPick={onChange} />
      </div>
      <CustomRange value={value} onChange={onChange} />
    </div>
  );
}

/**
 * Dashboard filter: the preset pills sit inline on the left; a pill trigger on
 * the right shows the current range and toggles a popover holding just the
 * custom From/To picker. Popover closes on outside-click or Escape.
 */
export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex max-w-full items-center gap-2">
      <PresetPills value={value} onPick={onChange} />
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-warm-white px-3.5 py-2 text-sm font-semibold text-ink shadow-[0_1px_3px_rgba(100,60,20,0.08)] transition-colors hover:border-brown"
        >
          <Calendar size={15} className="text-brown" />
          <span>{rangeLabel(value)}</span>
          <ChevronDown
            size={15}
            className={`text-ink-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="absolute right-0 z-30 mt-2 w-[300px] rounded-2xl border border-line bg-warm-white p-4 shadow-[0_8px_28px_rgba(100,60,20,0.16)]">
            <span className={labelCls}>Custom range</span>
            <CustomRange value={value} onChange={onChange} />
          </div>
        )}
      </div>
    </div>
  );
}
