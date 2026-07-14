"use client";

import { presets, type DateRange } from "@/lib/date-range";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown disabled:opacity-50";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";
const pillBase =
  "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors";
const pillOn = "border-brown bg-cream text-brown";
const pillOff = "border-line bg-cream text-ink-muted hover:border-brown hover:text-brown";

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const isActive = (from: string | null, to: string | null) =>
    value.from === from && value.to === to;

  return (
    <div>
      <span className={labelCls}>Date range</span>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {presets().map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange({ from: p.from, to: p.to })}
            className={`${pillBase} ${isActive(p.from, p.to) ? pillOn : pillOff}`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ from: null, to: null })}
          className={`${pillBase} ${isActive(null, null) ? pillOn : pillOff}`}
        >
          All time
        </button>
      </div>
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
    </div>
  );
}
