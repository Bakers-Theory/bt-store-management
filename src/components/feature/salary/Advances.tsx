"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { initials } from "@/lib/format";
import { ADVANCE_MODES, advanceTotals, openBalances } from "@/lib/advance";
import {
  fetchAdvanceBalances,
  fetchAdvances,
  rpcApproveAdvance,
  rpcDeleteAdvance,
  rpcRejectAdvance,
  rpcRequestAdvance,
} from "@/lib/supabase-data";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { localDay } from "@/components/feature/attendance/AttendanceDay";
import { AdvanceModal } from "./AdvanceModal";
import { AdvanceHistory } from "./AdvanceHistory";
import type { AdvanceBalance, SalaryMode, StaffAdvance } from "@/lib/types";

export function Advances({
  canRequest,
  canApprove,
}: {
  canRequest: boolean;
  canApprove: boolean;
}) {
  const bakery = useBakeryStore((s) => s.bakery);
  const currency = bakery.currency;
  const toast = useUIStore((s) => s.toast);

  const [balances, setBalances] = useState<AdvanceBalance[]>([]);
  const [pending, setPending] = useState<StaffAdvance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [requestFor, setRequestFor] = useState<AdvanceBalance | null>(null);
  const [historyFor, setHistoryFor] = useState<AdvanceBalance | null>(null);
  const [approveFor, setApproveFor] = useState<StaffAdvance | null>(null);
  const [rejectFor, setRejectFor] = useState<StaffAdvance | null>(null);

  const load = useCallback(async () => {
    const [b, all] = await Promise.all([fetchAdvanceBalances(), fetchAdvances()]);
    setBalances(b);
    setPending(all.filter((a) => a.status === "pending"));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    load()
      .then(() => alive && setLoaded(true))
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [load, retry]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      toast(ok, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(null);
    }
  };

  const totals = advanceTotals(balances);
  const open = openBalances(balances);
  const money = (n: number) => `${currency}${n.toFixed(2)}`;

  if (!loaded) {
    return (
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-[14px]" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-8 text-center text-sm text-ink-muted">
        <p className="mb-3">Couldn&apos;t load advances.</p>
        <button
          type="button"
          onClick={() => setRetry((t) => t + 1)}
          className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Totals */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ["Owing", String(totals.employees)],
          ["Advanced", money(totals.advanced)],
          ["Recovered", money(totals.recovered)],
          ["Outstanding", money(totals.outstanding)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[14px] border border-line bg-warm-white p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
            <div className="num mt-1 text-[15px] font-extrabold text-ink">{value}</div>
          </div>
        ))}
      </div>

      {/* Pending approvals — only for someone who can act on them. */}
      {canApprove && pending.length > 0 && (
        <div className="mb-4 rounded-[14px] border border-line bg-warn-bg p-3.5">
          <div className="mb-2.5 text-[12.5px] font-bold text-ink">
            {pending.length} advance{pending.length === 1 ? "" : "s"} awaiting approval
          </div>
          <div className="flex flex-col gap-2">
            {pending.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-[11px] bg-warm-white p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold">{a.employeeName}</div>
                  <div className="text-[11px] text-ink-light">
                    <span className="num font-bold text-ink">{money(a.amount)}</span> ·
                    requested {a.requestedOn}
                    {a.note ? ` · ${a.note}` : ""}
                  </div>
                </div>
                {busy === a.id && <Loader2 size={15} className="animate-spin text-ink-light" />}
                <button
                  type="button"
                  onClick={() => setApproveFor(a)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-lg bg-success px-2.5 py-1.5 text-[11.5px] font-bold text-warm-white disabled:opacity-60"
                >
                  <Check size={13} /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => setRejectFor(a)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-warm-white px-2.5 py-1.5 text-[11.5px] font-bold text-ink-muted disabled:opacity-60"
                >
                  <X size={13} /> Reject
                </button>
                <button
                  type="button"
                  onClick={() =>
                    act(a.id, () => rpcDeleteAdvance(a.id), "Request removed")
                  }
                  disabled={busy !== null}
                  aria-label={`Delete the pending advance for ${a.employeeName}`}
                  className="inline-flex items-center rounded-lg bg-danger-bg px-2 py-1.5 text-[11.5px] font-bold text-danger disabled:opacity-60"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The roster: everyone, so an advance can be given to anyone. */}
      {balances.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          No staff yet — add people under Settings → Staff first.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {balances.map((b) => (
            <div
              key={b.profileId}
              className="rounded-[14px] border border-line bg-warm-white p-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.04)]"
            >
              <div className="flex items-center gap-[11px]">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-cream-dark text-sm font-bold text-brown">
                  {initials(b.employeeName)}
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryFor(b)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-bold">{b.employeeName}</div>
                  <div className="text-[11.5px] text-ink-light">
                    {b.balance > 0
                      ? `${money(b.balance)} outstanding${b.oldestOpen ? ` since ${b.oldestOpen}` : ""}`
                      : b.monthlySalary > 0
                        ? "Nothing outstanding"
                        : "No salary set — cannot take an advance"}
                    {b.pendingAmount > 0 ? ` · ${money(b.pendingAmount)} awaiting approval` : ""}
                  </div>
                </button>
                {canRequest && b.monthlySalary > 0 && (
                  <button
                    type="button"
                    onClick={() => setRequestFor(b)}
                    disabled={busy !== null}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-brown px-2.5 py-2 text-[11.5px] font-bold text-warm-white disabled:opacity-60"
                  >
                    <Plus size={14} /> Advance
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-[12px] text-ink-light">
        An advance is capped at one month&apos;s salary. Recovery happens on the
        Payroll tab: the amount is pre-filled and can be changed month by month.
      </p>

      {requestFor && (
        <AdvanceModal
          employee={requestFor}
          currency={currency}
          onClose={() => setRequestFor(null)}
          onDone={async (amount, note) => {
            const target = requestFor;
            setRequestFor(null);
            await act(
              target.profileId,
              () => rpcRequestAdvance(target.profileId, amount, note),
              `Advance requested for ${target.employeeName}`,
            );
          }}
        />
      )}

      {historyFor && (
        <AdvanceHistory
          employee={historyFor}
          currency={currency}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {approveFor && (
        <ApproveModal
          advance={approveFor}
          currency={currency}
          onClose={() => setApproveFor(null)}
          onDone={async (on, mode) => {
            const target = approveFor;
            setApproveFor(null);
            await act(
              target.id,
              () => rpcApproveAdvance(target.id, on, mode),
              `Advance approved for ${target.employeeName}`,
            );
          }}
        />
      )}

      {rejectFor && (
        <RejectModal
          advance={rejectFor}
          currency={currency}
          onClose={() => setRejectFor(null)}
          onDone={async (reason) => {
            const target = rejectFor;
            setRejectFor(null);
            await act(
              target.id,
              () => rpcRejectAdvance(target.id, reason),
              "Advance rejected",
            );
          }}
        />
      )}
    </>
  );
}

/**
 * Approval and disbursement in one step, so the date and mode are required
 * here: an approved advance is money that has already left the till.
 */
function ApproveModal({
  advance,
  currency,
  onClose,
  onDone,
}: {
  advance: StaffAdvance;
  currency: string;
  onClose: () => void;
  onDone: (approvedOn: string, mode: SalaryMode) => void;
}) {
  const today = localDay();
  const [on, setOn] = useState(today);
  const [mode, setMode] = useState<SalaryMode>("Cash");

  return (
    <Modal title={`Approve advance — ${advance.employeeName}`} onClose={onClose}>
      <div className="mb-3.5 rounded-[11px] bg-cream p-3 text-center">
        <div className="text-[11px] font-semibold text-ink-muted">Amount</div>
        <div className="num text-xl font-extrabold text-ink">
          {currency}
          {advance.amount.toFixed(2)}
        </div>
        {advance.note && (
          <div className="mt-1 text-[11.5px] text-ink-muted">{advance.note}</div>
        )}
      </div>
      <div className="mb-3.5">
        <label htmlFor="apr-date" className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">
          Handed over on *
        </label>
        <input
          id="apr-date"
          type="date"
          value={on}
          max={today}
          onChange={(e) => setOn(e.target.value || today)}
          className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown"
        />
      </div>
      <div className="mb-3.5">
        <span className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">Payment mode *</span>
        <div className="grid grid-cols-2 gap-1.5">
          {ADVANCE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-[10px] border px-2 py-2.5 text-[12.5px] font-bold transition-colors ${
                mode === m
                  ? "border-brown bg-brown text-warm-white"
                  : "border-line bg-cream text-ink-muted"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDone(on, mode)}
        disabled={!on}
        className="w-full rounded-xl bg-success p-3 text-sm font-bold text-warm-white disabled:opacity-60"
      >
        Approve &amp; record as handed over
      </button>
      <p className="mt-3 text-center text-[11.5px] text-ink-light">
        This records the money as paid out. It will be recovered from salary on
        the Payroll tab.
      </p>
    </Modal>
  );
}

function RejectModal({
  advance,
  currency,
  onClose,
  onDone,
}: {
  advance: StaffAdvance;
  currency: string;
  onClose: () => void;
  onDone: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Modal title={`Reject advance — ${advance.employeeName}`} onClose={onClose}>
      <p className="mb-3.5 text-[12.5px] text-ink-muted">
        Refusing{" "}
        <span className="num font-bold text-ink">
          {currency}
          {advance.amount.toFixed(2)}
        </span>
        . A reason is required, and is kept on the record.
      </p>
      <div className="mb-3.5">
        <label htmlFor="rej-reason" className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">
          Reason *
        </label>
        <input
          id="rej-reason"
          type="text"
          value={reason}
          placeholder="e.g. previous advance still outstanding"
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown"
        />
      </div>
      <button
        type="button"
        onClick={() => onDone(reason.trim())}
        disabled={reason.trim().length === 0}
        className="w-full rounded-xl bg-brown p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Reject request
      </button>
    </Modal>
  );
}
