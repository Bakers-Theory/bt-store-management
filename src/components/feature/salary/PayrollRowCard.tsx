"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Receipt as ReceiptIcon, RotateCcw, Trash2 } from "lucide-react";
import { isAdjusted, isStale, missingDays, round2 } from "@/lib/salary";
import { recoveryCeiling, isRecoveryValid } from "@/lib/advance";
import type { PayrollRow } from "@/lib/types";

/**
 * One employee's payroll for the selected month.
 *
 * Extracted from PayrollMonth so the month header, totals and fetching stay
 * separable from the per-row detail. Presentational: every action is a callback
 * and no data is fetched here.
 */
export function PayrollRowCard({
  row: r,
  currency,
  canEdit,
  canPay,
  canRecover,
  busy,
  onPrepare,
  onAdjust,
  onDelete,
  onPayslip,
  onMarkPaid,
  onReopen,
  onSetRecovery,
}: {
  row: PayrollRow;
  currency: string;
  canEdit: boolean;
  canPay: boolean;
  canRecover: boolean;
  busy: boolean;
  onPrepare: () => void;
  onAdjust: () => void;
  onDelete: () => void;
  onPayslip: () => void;
  onMarkPaid: () => void;
  onReopen: () => void;
  onSetRecovery: (amount: number) => void;
}) {
  const money = (n: number) => `${currency}${n.toFixed(2)}`;
  const gap = missingDays(r);
  const net = r.net ?? r.computedNet;

  // Draft is local so typing doesn't refetch the month. Seeded from the filed
  // recovery, not the suggestion, so an existing figure is never silently
  // replaced by a different default.
  const [draft, setDraft] = useState<string | null>(null);
  const ceiling = recoveryCeiling(r.advanceBalance, r.advanceRecovery, net);
  const recoveryValue = draft ?? String(r.advanceRecovery || "");
  const parsedRecovery = round2(parseFloat(recoveryValue) || 0);
  const recoveryDirty = draft !== null && parsedRecovery !== r.advanceRecovery;
  const recoveryOk = isRecoveryValid(parsedRecovery, r.advanceBalance, r.advanceRecovery, net);
  // Only meaningful on an unpaid record with something to recover — a paid
  // period is closed, and a zero ceiling means nothing is owed.
  const showRecovery = r.status === "unpaid" && canRecover && ceiling > 0;

  return (
    <div className="rounded-[14px] border border-line bg-warm-white p-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.04)]">
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{r.employeeName}</div>
          <div className="text-[11.5px] text-ink-light">
            {r.recorded}/{r.calendarDays} days recorded
            {gap > 0 ? ` · ${gap} missing` : ""}
            {r.unpaidDays > 0 ? ` · ${r.unpaidDays} unpaid` : ""}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-[11px] py-1 text-[11px] font-bold ${
            r.status === "paid"
              ? "bg-success-bg text-success"
              : r.status === "unpaid"
                ? "bg-warn-bg text-warn"
                : "bg-cream-dark text-ink-muted"
          }`}
        >
          {r.status === "none" ? "Not prepared" : r.status === "paid" ? "Paid" : "Unpaid"}
        </span>
      </div>

      <div className="mb-2.5 grid grid-cols-3 gap-2 rounded-[11px] bg-cream p-2.5 text-center">
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Gross</div>
          <div className="num text-[13px] font-bold">{money(r.gross)}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Deduction</div>
          <div className="num text-[13px] font-bold text-danger">
            {r.deduction > 0 ? `−${money(r.deduction)}` : money(0)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Net</div>
          <div className="num text-[13px] font-extrabold">{money(net)}</div>
        </div>
      </div>

      {r.advanceRecovery > 0 && (
        <div className="mb-2.5 flex items-center justify-between rounded-[11px] bg-cream px-2.5 py-2 text-[12px]">
          <span className="font-semibold text-ink-muted">Less advance recovery</span>
          <span className="num font-bold text-danger">−{money(r.advanceRecovery)}</span>
        </div>
      )}
      {r.advanceRecovery > 0 && (
        <div className="mb-2.5 flex items-center justify-between rounded-[11px] bg-cream-dark px-2.5 py-2 text-[12.5px]">
          <span className="font-bold text-ink">Amount payable</span>
          <span className="num font-extrabold text-ink">{money(net - r.advanceRecovery)}</span>
        </div>
      )}

      {showRecovery && (
        <div className="mb-2.5 rounded-[11px] border border-line bg-cream p-2.5">
          <label
            htmlFor={`rec-${r.profileId}`}
            className="mb-1.5 block text-[11px] font-bold text-[#8a6a3c]"
          >
            Recover advance ({currency}) — up to {money(ceiling)}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`rec-${r.profileId}`}
              type="number"
              min="0"
              max={ceiling}
              step="0.01"
              inputMode="decimal"
              value={recoveryValue}
              placeholder="0.00"
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 rounded-[10px] border border-line bg-warm-white px-2.5 py-2 text-[13px] outline-none focus:border-brown disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setDraft(String(ceiling))}
              disabled={busy}
              className="shrink-0 rounded-[10px] border border-line bg-warm-white px-2.5 py-2 text-[11.5px] font-bold text-ink-muted disabled:opacity-60"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                onSetRecovery(parsedRecovery);
                setDraft(null);
              }}
              disabled={busy || !recoveryDirty || !recoveryOk}
              className="shrink-0 rounded-[10px] bg-brown px-3 py-2 text-[11.5px] font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {/* The DB enforces this too; saying it here avoids a round trip. */}
          {!recoveryOk && (
            <p className="mt-1.5 text-[11px] font-semibold text-danger">
              At most {money(ceiling)} can come off this month.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-light">
            Outstanding advance {money(r.advanceBalance + r.advanceRecovery)}.
          </p>
        </div>
      )}

      {/*
        Two different things, deliberately worded differently: someone changed
        the figure, versus the days beneath it moved. Conflating them was the
        original defect.
      */}
      {isAdjusted(r) && r.storedComputedNet !== null && (
        <div className="mb-2.5 text-[11.5px] font-semibold text-warn">
          Adjusted from {money(r.storedComputedNet)}
          {r.overrideReason ? ` — ${r.overrideReason}` : ""}
        </div>
      )}
      {isStale(r) && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[10px] bg-warn-bg px-2.5 py-2 text-[11.5px] text-ink-muted">
          <AlertTriangle size={13} className="shrink-0 text-warn" />
          <span>
            Attendance changed since this was prepared — recalculated net is{" "}
            <span className="num font-bold">{money(r.computedNet)}</span>.
          </span>
          {r.status === "unpaid" && canEdit && (
            <button
              type="button"
              onClick={onPrepare}
              disabled={busy}
              className="ml-auto rounded-lg bg-brown px-2.5 py-1 text-[11px] font-bold text-warm-white disabled:opacity-60"
            >
              Recalculate
            </button>
          )}
          {r.status === "paid" && (
            <span className="ml-auto font-semibold text-warn">Reopen to recalculate</span>
          )}
        </div>
      )}
      {r.status === "paid" && r.paidOn && (
        <div className="mb-2.5 text-[11.5px] text-ink-light">
          Paid {r.paidOn} by {r.paymentMode}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-line-soft pt-2.5">
        {busy && <Loader2 size={15} className="animate-spin text-ink-light" />}
        {r.status === "none" && canEdit && (
          <button
            type="button"
            onClick={onPrepare}
            disabled={busy}
            className="rounded-lg bg-brown px-3 py-1.5 text-[12px] font-bold text-warm-white disabled:opacity-60"
          >
            Prepare
          </button>
        )}
        {r.status === "unpaid" && canEdit && (
          <>
            <button
              type="button"
              onClick={onAdjust}
              disabled={busy}
              className="rounded-lg border border-line bg-warm-white px-3 py-1.5 text-[12px] font-bold text-ink-muted disabled:opacity-60"
            >
              Adjust net
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label={`Remove payroll record for ${r.employeeName}`}
              className="inline-flex items-center gap-1 rounded-lg bg-danger-bg px-2.5 py-1.5 text-[12px] font-bold text-danger disabled:opacity-60"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
        {r.status !== "none" && (
          <button
            type="button"
            onClick={onPayslip}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-warm-white px-2.5 py-1.5 text-[12px] font-bold text-ink-muted disabled:opacity-60"
          >
            <ReceiptIcon size={13} /> Payslip
          </button>
        )}
        {r.status === "unpaid" && canPay && (
          <button
            type="button"
            onClick={onMarkPaid}
            disabled={busy}
            className="rounded-lg bg-success px-3 py-1.5 text-[12px] font-bold text-warm-white disabled:opacity-60"
          >
            Mark paid
          </button>
        )}
        {r.status === "paid" && canPay && (
          <button
            type="button"
            onClick={onReopen}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-warm-white px-3 py-1.5 text-[12px] font-bold text-ink-muted disabled:opacity-60"
          >
            <RotateCcw size={13} /> Reopen
          </button>
        )}
      </div>
    </div>
  );
}
