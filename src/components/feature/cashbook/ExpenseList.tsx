"use client";

import { ChevronRight } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { expenseStatusLabel, expenseStatusTone } from "@/lib/expense";
import type { Expense } from "@/lib/types";

// A date-only string must never go through `new Date()` — that parses as UTC
// midnight and renders the previous day in a negative-offset timezone.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dayLabel = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};

const toneCls = {
  warn: "bg-amber-100 text-amber-800",
  good: "bg-green-100 text-green-800",
  bad: "bg-red-100 text-red-800",
  muted: "bg-[#f3e6d2] text-[#8a6a3c]",
} as const;

export function ExpenseList({
  expenses,
  onOpen,
}: {
  expenses: Expense[];
  onOpen: (e: Expense) => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  if (expenses.length === 0) {
    return (
      <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center">
        <p className="text-sm font-semibold text-ink">No expenses</p>
        <p className="mt-1 text-xs text-ink-muted">Nothing matches these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      {expenses.map((e) => (
        <button
          key={e.id}
          onClick={() => onOpen(e)}
          className={`flex w-full items-center gap-3 border-t border-line-soft px-5 py-3.5 text-left first:border-t-0 hover:bg-[#faf4ea] ${
            e.status === "cancelled" ? "opacity-60" : ""
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">
              {e.vendorDisplay || e.categoryName}
              <span className="ml-1.5 font-normal text-ink-muted">#{e.expenseNo}</span>
            </p>
            <p className="truncate text-[11px] text-ink-muted">
              {dayLabel(e.expenseDate)} · {e.categoryPath} · {e.paymentMode}
              {e.invoiceNo && ` · inv ${e.invoiceNo}`}
            </p>
          </div>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              toneCls[expenseStatusTone(e.status)]
            }`}
          >
            {expenseStatusLabel(e.status)}
          </span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
            {money(e.amount)}
          </span>
          <ChevronRight size={15} className="shrink-0 text-[#c0a880]" />
        </button>
      ))}
    </div>
  );
}
