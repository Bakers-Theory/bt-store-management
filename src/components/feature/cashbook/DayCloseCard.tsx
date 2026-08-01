"use client";

import { useState } from "react";
import { Loader2, Lock, LockOpen, Wand2 } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { cashDifference, differenceLabel } from "@/lib/cashbook";
import { rpcAdjustBankBalance, rpcCloseCashDay } from "@/lib/supabase-data";
import type { CashDaySummary } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const rowCls = "flex items-center justify-between py-1.5 text-sm";
const sectionCls = "mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8a6a3c]";

const toneCls = {
  short: "text-red-700",
  excess: "text-amber-700",
  exact: "text-green-700",
} as const;

export function DayCloseCard({
  onDate,
  summary,
  canClose,
  canEdit,
  onChanged,
}: {
  onDate: string;
  summary: CashDaySummary;
  canClose: boolean;
  /** `cashbook.entry` — squaring the bank posts an ordinary adjustment entry. */
  canEdit: boolean;
  onChanged: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  const [counted, setCounted] = useState("");
  const [bank, setBank] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const closed = summary.status === "closed";
  // Live as the operator types, so the difference is visible before committing.
  const typed = counted === "" ? null : Number(counted);
  const diff =
    typed === null ? null : cashDifference(typed, summary.expectedCash);
  const label = diff === null ? null : differenceLabel(diff);

  // The bank figure is optional (migration 0050, decision 6) — a blank field
  // closes the day with "not checked" rather than with a guess. A negative
  // figure is allowed: an account can be overdrawn.
  const typedBank =
    bank === "" || !Number.isFinite(Number(bank)) ? null : Number(bank);
  const bankDiff =
    typedBank === null ? null : cashDifference(typedBank, summary.expectedBank);
  const bankLabel = bankDiff === null ? null : differenceLabel(bankDiff);

  const submit = () => {
    if (typed === null || typed < 0 || saving) return;
    // A discrepancy without an explanation is the thing worth blocking. An
    // exact tally needs no note.
    if ((diff !== 0 || (bankDiff !== null && bankDiff !== 0)) && remarks.trim() === "") {
      toast("Something doesn't match — say what you found", "error");
      return;
    }
    setSaving(true);
    rpcCloseCashDay(onDate, typed, remarks.trim(), typedBank)
      .then(() => {
        toast("Day closed", "success");
        onChanged();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setSaving(false));
  };

  // Posts the gap as a real "Other › Adjustment" bank entry, so the book ends
  // where the bank does. Deliberately separate from closing the day.
  const squareBank = () => {
    if (typedBank === null || adjusting) return;
    setAdjusting(true);
    rpcAdjustBankBalance(onDate, typedBank, `Bank closing on ${onDate}`)
      .then(() => {
        toast("Adjustment posted — the bank now matches the book", "success");
        onChanged();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setAdjusting(false));
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

      <p className={sectionCls}>Cash</p>
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

      <p className={`mt-4 ${sectionCls}`}>Bank</p>
      <div className="divide-y divide-line-soft border-y border-line-soft">
        <div className={rowCls}>
          <span className="text-ink-muted">Opening bank</span>
          <span className="font-semibold tabular-nums text-ink">
            {money(summary.openingBank)}
          </span>
        </div>
        <div className={rowCls}>
          <span className="text-ink-muted">Bank in</span>
          <span className="font-semibold tabular-nums text-green-700">
            +{money(summary.bankIn)}
          </span>
        </div>
        <div className={rowCls}>
          <span className="text-ink-muted">Bank out</span>
          <span className="font-semibold tabular-nums text-red-700">
            −{money(summary.bankOut)}
          </span>
        </div>
        <div className={rowCls}>
          <span className="font-bold text-ink">Bank per the book</span>
          <span className="text-base font-bold tabular-nums text-ink">
            {money(summary.expectedBank)}
          </span>
        </div>
      </div>

      {closed ? (
        <div className="mt-3.5 space-y-1.5">
          <div className={rowCls}>
            <span className="text-ink-muted">Cash counted</span>
            <span className="font-semibold tabular-nums text-ink">
              {money(summary.countedCash ?? 0)}
            </span>
          </div>
          <div className={rowCls}>
            <span className="text-ink-muted">Bank closing</span>
            <span className="font-semibold tabular-nums text-ink">
              {summary.closingBank === null ? "Not checked" : money(summary.closingBank)}
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
            <label className={labelCls} htmlFor="dc-bank">
              Bank closing balance ({currency}) — optional
            </label>
            <input
              id="dc-bank"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              disabled={!canClose}
              placeholder="Read it off the bank app"
              className="w-full rounded-[11px] border border-line bg-white px-3 py-2.5 text-base font-bold tabular-nums text-ink disabled:opacity-60"
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              Leave it blank if nobody checked the bank — the day records that as
              unchecked rather than as zero.
            </p>
          </div>

          {bankLabel && bankDiff !== null && (
            <div className="rounded-[11px] bg-[#f9f2e7] px-3.5 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#8a6a3c]">
                  Bank {bankLabel.label.toLowerCase()}
                </span>
                <span
                  className={`text-base font-bold tabular-nums ${toneCls[bankLabel.tone]}`}
                >
                  {bankDiff > 0 ? "+" : bankDiff < 0 ? "−" : ""}
                  {money(Math.abs(bankDiff))}
                </span>
              </div>
              {bankDiff !== 0 && canEdit && (
                <button
                  disabled={adjusting}
                  onClick={squareBank}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-line bg-warm-white py-2 text-xs font-bold text-ink disabled:opacity-50"
                >
                  {adjusting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Wand2 size={13} />
                  )}
                  Post {money(Math.abs(bankDiff))} adjustment to square the book
                </button>
              )}
              {bankDiff !== 0 && (
                <p className="mt-1 text-[11px] text-ink-muted">
                  This posts an <strong>Other › Adjustment</strong> bank entry on
                  this day, so the book ends where the bank does.
                </p>
              )}
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="dc-remarks">
              Remarks{" "}
              {(diff !== null && diff !== 0) || (bankDiff !== null && bankDiff !== 0)
                ? "(required)"
                : "(optional)"}
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
