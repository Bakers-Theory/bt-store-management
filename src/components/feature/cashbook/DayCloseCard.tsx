"use client";

import { useState } from "react";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { cashDifference, differenceLabel } from "@/lib/cashbook";
import { rpcCloseCashDay } from "@/lib/supabase-data";
import type { CashDaySummary } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const rowCls = "flex items-center justify-between py-1.5 text-sm";

const toneCls = {
  short: "text-red-700",
  excess: "text-amber-700",
  exact: "text-green-700",
} as const;

export function DayCloseCard({
  onDate,
  summary,
  canClose,
  onClosed,
}: {
  onDate: string;
  summary: CashDaySummary;
  canClose: boolean;
  onClosed: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  const [counted, setCounted] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const closed = summary.status === "closed";
  // Live as the operator types, so the difference is visible before committing.
  const typed = counted === "" ? null : Number(counted);
  const diff =
    typed === null ? null : cashDifference(typed, summary.expectedCash);
  const label = diff === null ? null : differenceLabel(diff);

  const submit = () => {
    if (typed === null || typed < 0 || saving) return;
    // A discrepancy without an explanation is the thing worth blocking. An
    // exact tally needs no note.
    if (diff !== 0 && remarks.trim() === "") {
      toast("The count doesn't match — say what you found", "error");
      return;
    }
    setSaving(true);
    rpcCloseCashDay(onDate, typed, remarks.trim())
      .then(() => {
        toast("Day closed", "success");
        onClosed();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setSaving(false));
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-5 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <div className="mb-3 flex items-center gap-2">
        {closed ? (
          <Lock size={15} className="text-[#8a6a3c]" />
        ) : (
          <LockOpen size={15} className="text-[#8a6a3c]" />
        )}
        <h2 className="font-display text-lg font-bold text-ink">
          {closed ? "Day closed" : "Close the day"}
        </h2>
      </div>

      <div className="divide-y divide-line-soft border-y border-line-soft">
        <div className={rowCls}>
          <span className="text-ink-muted">Opening cash</span>
          <span className="font-semibold tabular-nums text-ink">
            {money(summary.openingCash)}
          </span>
        </div>
        <div className={rowCls}>
          <span className="text-ink-muted">Cash in</span>
          <span className="font-semibold tabular-nums text-green-700">
            +{money(summary.cashIn)}
          </span>
        </div>
        <div className={rowCls}>
          <span className="text-ink-muted">Cash out</span>
          <span className="font-semibold tabular-nums text-red-700">
            −{money(summary.cashOut)}
          </span>
        </div>
        <div className={rowCls}>
          <span className="font-bold text-ink">Expected in the drawer</span>
          <span className="text-base font-bold tabular-nums text-ink">
            {money(summary.expectedCash)}
          </span>
        </div>
      </div>

      {closed ? (
        <div className="mt-3.5 space-y-1.5">
          <div className={rowCls}>
            <span className="text-ink-muted">Counted</span>
            <span className="font-semibold tabular-nums text-ink">
              {money(summary.countedCash ?? 0)}
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            This day is locked. Nothing can post to it until an admin reopens it.
          </p>
        </div>
      ) : (
        <div className="mt-3.5 space-y-3">
          <div>
            <label className={labelCls} htmlFor="dc-counted">
              Cash counted in the drawer ({currency})
            </label>
            <input
              id="dc-counted"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              disabled={!canClose}
              className="w-full rounded-[11px] border border-line bg-white px-3 py-2.5 text-base font-bold tabular-nums text-ink disabled:opacity-60"
            />
          </div>

          {label && diff !== null && (
            <div className="rounded-[11px] bg-[#f9f2e7] px-3.5 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#8a6a3c]">{label.label}</span>
                <span className={`text-base font-bold tabular-nums ${toneCls[label.tone]}`}>
                  {diff > 0 ? "+" : diff < 0 ? "−" : ""}
                  {money(Math.abs(diff))}
                </span>
              </div>
              {diff !== 0 && (
                <p className="mt-1 text-[11px] text-ink-muted">
                  The difference is recorded against this day. To square the ledger
                  with the drawer, add an <strong>Other → Adjustment</strong> entry
                  on the Cashbook.
                </p>
              )}
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="dc-remarks">
              Remarks {diff !== null && diff !== 0 ? "(required)" : "(optional)"}
            </label>
            <input
              id="dc-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              disabled={!canClose}
              placeholder="50 short — checking with the counter"
              className="w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink disabled:opacity-60"
            />
          </div>

          {canClose ? (
            <button
              disabled={typed === null || typed < 0 || saving}
              onClick={submit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Close the day
            </button>
          ) : (
            <p className="text-xs text-ink-muted">
              You don&apos;t have permission to close the day.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
