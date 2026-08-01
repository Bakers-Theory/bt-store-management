"use client";

import { LockOpen } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { differenceLabel } from "@/lib/cashbook";
import { rpcReopenCashDay } from "@/lib/supabase-data";
import type { CashDay } from "@/lib/types";

// A date-only string must never go through `new Date()` — that parses as UTC
// midnight and renders the previous day in a negative-offset timezone.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dayLabel = (ymd: string) => {
  const [y, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

const toneCls = {
  short: "text-red-700",
  excess: "text-amber-700",
  exact: "text-green-700",
} as const;

export function DayHistory({
  days,
  canReopen,
  onChanged,
}: {
  days: CashDay[];
  canReopen: boolean;
  onChanged: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  const reopen = (d: CashDay) => {
    const reason = prompt(
      `Reopen ${dayLabel(d.onDate)}?\n\nWhy? This is recorded in the activity log.`,
    );
    if (reason === null) return;
    if (reason.trim() === "") {
      toast("A reason is required to reopen a day", "error");
      return;
    }
    rpcReopenCashDay(d.onDate, reason.trim())
      .then(() => {
        toast(`${dayLabel(d.onDate)} reopened`, "success");
        onChanged();
      })
      .catch((err: Error) => toast(err.message, "error"));
  };

  if (days.length === 0) {
    return (
      <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center">
        <p className="text-sm font-semibold text-ink">No days closed yet</p>
        <p className="mt-1 text-xs text-ink-muted">
          Count the drawer and close today to start the record.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      {days.map((d) => {
        const label = differenceLabel(d.difference);
        return (
          <div key={d.onDate} className="border-t border-line-soft px-5 py-3.5 first:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">
                  {dayLabel(d.onDate)}
                  {d.status === "open" && (
                    <span className="ml-2 rounded bg-[#f3e6d2] px-1.5 py-0.5 text-[10px] font-bold text-[#8a6a3c]">
                      reopened
                    </span>
                  )}
                </p>
                {/* The counted cash is the day's closing balance — it is also the
                    next day's opening, so the two figures lead the row. */}
                <p className="text-[13px] font-semibold tabular-nums text-ink">
                  <span className="text-[10px] font-bold uppercase text-[#8a6a3c]">
                    Cash
                  </span>{" "}
                  Open {money(d.openingCash)}{" "}
                  <span className="font-normal text-ink-muted">→</span> Close{" "}
                  {money(d.countedCash)}
                </p>
                {/* Null on days closed before the bank side existed, and on any
                    day nobody checked the bank. Saying so beats showing a zero. */}
                <p className="text-[13px] font-semibold tabular-nums text-ink">
                  <span className="text-[10px] font-bold uppercase text-[#8a6a3c]">
                    Bank
                  </span>{" "}
                  {d.closingBank === null || d.openingBank === null ? (
                    <span className="font-normal text-ink-muted">Not checked</span>
                  ) : (
                    <>
                      Open {money(d.openingBank)}{" "}
                      <span className="font-normal text-ink-muted">→</span> Close{" "}
                      {money(d.closingBank)}
                    </>
                  )}
                </p>
                <p className="text-[11px] text-ink-muted">
                  Expected {money(d.expectedCash)} cash
                  {d.expectedBank !== null && ` · ${money(d.expectedBank)} bank`}
                  {d.closedByName && ` · by ${d.closedByName}`}
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="text-right">
                  <p className={`text-sm font-bold tabular-nums ${toneCls[label.tone]}`}>
                    {d.difference > 0 ? "+" : d.difference < 0 ? "−" : ""}
                    {money(Math.abs(d.difference))}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-[#8a6a3c]">
                    {label.label}
                  </p>
                  {d.bankDifference !== null && d.bankDifference !== 0 && (
                    <p
                      className={`text-[11px] font-bold tabular-nums ${
                        toneCls[differenceLabel(d.bankDifference).tone]
                      }`}
                    >
                      bank {d.bankDifference > 0 ? "+" : "−"}
                      {money(Math.abs(d.bankDifference))}
                    </p>
                  )}
                </div>
                {canReopen && d.status === "closed" && (
                  <button
                    onClick={() => reopen(d)}
                    aria-label={`Reopen ${dayLabel(d.onDate)}`}
                    className="rounded-lg p-1.5 text-[#8a6a3c] hover:bg-[#f6ecdd]"
                  >
                    <LockOpen size={14} />
                  </button>
                )}
              </div>
            </div>
            {d.remarks && (
              <p className="mt-1.5 text-xs italic text-ink-muted">“{d.remarks}”</p>
            )}
            {d.reopenReason && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Reopened by {d.reopenedByName}: {d.reopenReason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
