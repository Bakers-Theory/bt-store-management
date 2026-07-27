"use client";

import { initials } from "@/lib/format";
import type { Employee } from "@/lib/types";

/**
 * Whose attendance you're looking at. A row of chips rather than a dropdown:
 * a shop roster is small enough to show whole, and one tap beats open-scan-tap.
 * Scrolls sideways instead of wrapping so it stays one line on a phone.
 */
export function EmployeePicker({
  employees,
  value,
  onChange,
}: {
  employees: Employee[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (employees.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Employee"
      // Negative margin so the chips can bleed to the screen edge as they scroll.
      className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {employees.map((e) => {
        const on = e.id === value;
        return (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(e.id)}
            className={`flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-[13px] font-bold transition-colors ${
              on
                ? "border-brown bg-brown text-warm-white"
                : "border-line bg-warm-white text-ink-muted"
            }`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                on ? "bg-warm-white/20 text-warm-white" : "bg-cream-dark text-brown"
              }`}
            >
              {initials(e.name)}
            </span>
            {e.name}
          </button>
        );
      })}
    </div>
  );
}
