"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import {
  canTransition,
  expenseStatusLabel,
  expenseStatusTone,
  gstSplit,
} from "@/lib/expense";
import { fundsShortfall } from "@/lib/cashbook";
import {
  fetchCashEntriesForSource,
  fetchCashbookSummary,
  fetchExpense,
  fetchExpenseEvents,
  rpcCancelExpense,
  rpcDeleteExpense,
  rpcPayExpense,
  rpcRejectExpense,
} from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { CashEntry, Expense, ExpenseEvent } from "@/lib/types";

// A date-only string must never go through `new Date()` — that parses as UTC
// midnight and renders the previous day in a negative-offset timezone.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dayLabel = (ymd: string) => {
  const [y, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** `at` is a full ISO instant, not a date-only string — parsing it is correct. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const toneCls = {
  warn: "bg-amber-100 text-amber-800",
  good: "bg-green-100 text-green-800",
  bad: "bg-red-100 text-red-800",
  muted: "bg-[#f3e6d2] text-[#8a6a3c]",
} as const;

const EVENT_LABEL: Record<ExpenseEvent["event"], string> = {
  created: "Recorded",
  edited: "Edited",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  cancelled: "Cancelled",
  deleted: "Removed",
};

/** Renders an `edited` event's field diff as "amount: 5000 → 4800". */
function diffLines(detail: Record<string, unknown>): string[] {
  return Object.entries(detail)
    .filter(([, v]) => Array.isArray(v) && v.length === 2)
    .map(([k, v]) => {
      const [before, after] = v as [unknown, unknown];
      return `${k}: ${String(before) || "—"} → ${String(after) || "—"}`;
    });
}

const rowCls = "flex items-start justify-between gap-3 px-4 py-2.5 text-sm";
const headCls = "mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8a6a3c]";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-3 py-2 text-xs font-bold disabled:opacity-50";

export function ExpenseDetail({
  expenseId,
  onClose,
  onEdit,
  onChanged,
}: {
  expenseId: string;
  onClose: () => void;
  onEdit: (e: Expense) => void;
  onChanged: () => void;
}) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;
  const today = isoDateLocal(new Date());

  const perms = {
    canPay: hasPermission(user, "expense.pay"),
    canCancel: hasPermission(user, "expense.cancel"),
  };

  const [expense, setExpense] = useState<Expense | null>(null);
  const [events, setEvents] = useState<ExpenseEvent[]>([]);
  const [entries, setEntries] = useState<CashEntry[]>([]);
  // Live cash and bank, so "Approve & pay" can say up front that the money is
  // not there. pay_expense() (0059) is what actually refuses it.
  const [balances, setBalances] = useState<{ cash: number; bank: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // Remove arms an inline confirm in the action bar rather than a browser
  // dialog, so the question stays inside the modal it belongs to.
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      fetchExpense(expenseId),
      fetchExpenseEvents(expenseId),
      fetchCashEntriesForSource("expense", expenseId),
      // Kept out of the group above and swallowed on failure: cashbook_summary
      // needs `cashbook.view`, which an approver may not hold, and a missing
      // balance must not turn into "couldn't load this expense".
      fetchCashbookSummary()
        .then((s) => ({ cash: s.cashBalance, bank: s.bankBalance }))
        .catch(() => null),
    ])
      .then(([e, ev, ce, b]) => {
        setExpense(e);
        setEvents(ev);
        setEntries(ce);
        setBalances(b);
      })
      .catch(() => toast("Couldn't load this expense", "error"))
      .finally(() => setLoaded(true));
  }, [expenseId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = (run: Promise<void>, msg: string) => {
    setBusy(true);
    run
      .then(() => {
        toast(msg, "success");
        void load();
        onChanged();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setBusy(false));
  };

  const pay = () => {
    if (!expense) return;
    // Paid today by default; the RPC guards the posting date against a closed
    // day, and the expense's own date is when the cost was incurred.
    act(
      rpcPayExpense(
        expense.id,
        today,
        expense.paymentMode,
        expense.splitCash,
        expense.splitBank,
        expense.splitBankMode,
      ),
      "Expense approved and paid",
    );
  };

  const reject = () => {
    if (!expense) return;
    const reason = prompt("Why is this being rejected?");
    if (reason === null) return;
    if (reason.trim() === "") {
      toast("A reason is required", "error");
      return;
    }
    act(rpcRejectExpense(expense.id, reason.trim()), "Expense rejected");
  };

  const cancel = () => {
    if (!expense) return;
    const reason = prompt(
      "Why is this paid expense being cancelled?\n\nThe money will be put back on the cash book.",
    );
    if (reason === null) return;
    if (reason.trim() === "") {
      toast("A reason is required", "error");
      return;
    }
    act(rpcCancelExpense(expense.id, reason.trim()), "Expense cancelled and reversed");
  };

  // Not routed through `act`: the record is gone once this resolves, so there
  // is nothing to reload, and the close must wait for the delete to land —
  // closing first unmounts this component while its own reload is in flight.
  const remove = () => {
    if (!expense) return;
    setBusy(true);
    rpcDeleteExpense(expense.id)
      .then(() => {
        toast("Expense removed", "success");
        onChanged();
        onClose();
      })
      .catch((err: Error) => {
        toast(err.message, "error");
        setConfirmRemove(false);
        setBusy(false);
      });
  };

  if (!loaded || !expense) {
    return (
      <Modal title="Expense" onClose={onClose}>
        <Skeleton className="h-64 w-full rounded-[18px]" />
      </Modal>
    );
  }

  const { base, gst } = gstSplit(expense.amount, expense.gstIncluded, expense.gstAmount);
  const mine = expense.createdById === user?.id;
  const canEdit = expense.status === "pending" && (mine || perms.canPay);

  // A Mixed payment must clear on BOTH sides — pay_expense() checks each half
  // before posting either, so a payment that only half fits is refused whole.
  const payShortfall = !balances
    ? null
    : expense.paymentMode === "Mixed"
      ? (fundsShortfall("cash", balances.cash, expense.splitCash) ??
        fundsShortfall("bank", balances.bank, expense.splitBank))
      : expense.paymentMode === "Cash"
        ? fundsShortfall("cash", balances.cash, expense.amount)
        : fundsShortfall("bank", balances.bank, expense.amount);

  return (
    <Modal title={`Expense #${expense.expenseNo}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold tabular-nums text-ink">
              {money(expense.amount)}
            </p>
            <p className="text-xs text-ink-muted">
              {expense.categoryPath} · {dayLabel(expense.expenseDate)}
            </p>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-1 text-[11px] font-bold ${
              toneCls[expenseStatusTone(expense.status)]
            }`}
          >
            {expenseStatusLabel(expense.status)}
          </span>
        </div>

        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          <div className={rowCls}>
            <span className="text-ink-muted">Vendor</span>
            <span className="text-right font-semibold text-ink">
              {expense.vendorDisplay || "—"}
              {expense.vendorSupplierId && (
                <span className="block text-[11px] font-normal text-ink-muted">
                  linked supplier · does not affect payables
                </span>
              )}
            </span>
          </div>
          {expense.gstIncluded && (
            <div className={`border-t border-line-soft ${rowCls}`}>
              <span className="text-ink-muted">Before GST / GST</span>
              <span className="font-semibold tabular-nums text-ink">
                {money(base)} / {money(gst)}
              </span>
            </div>
          )}
          <div className={`border-t border-line-soft ${rowCls}`}>
            <span className="text-ink-muted">Paid by</span>
            <span className="text-right font-semibold text-ink">
              {expense.paymentMode}
              {expense.paymentMode === "Mixed" && (
                <span className="block text-[11px] font-normal tabular-nums text-ink-muted">
                  {money(expense.splitCash)} cash + {money(expense.splitBank)}{" "}
                  {expense.splitBankMode}
                </span>
              )}
            </span>
          </div>
          {expense.paidOn && (
            <div className={`border-t border-line-soft ${rowCls}`}>
              <span className="text-ink-muted">Paid on</span>
              <span className="font-semibold text-ink">{dayLabel(expense.paidOn)}</span>
            </div>
          )}
          {expense.invoiceNo && (
            <div className={`border-t border-line-soft ${rowCls}`}>
              <span className="text-ink-muted">Invoice</span>
              <span className="font-semibold text-ink">{expense.invoiceNo}</span>
            </div>
          )}
          {expense.description && (
            <div className={`border-t border-line-soft ${rowCls}`}>
              <span className="text-ink-muted">Notes</span>
              <span className="text-right text-ink">{expense.description}</span>
            </div>
          )}
          <div className={`border-t border-line-soft ${rowCls}`}>
            <span className="text-ink-muted">Recorded by</span>
            <span className="font-semibold text-ink">{expense.createdByName}</span>
          </div>
          {expense.approvedByName && (
            <div className={`border-t border-line-soft ${rowCls}`}>
              <span className="text-ink-muted">
                {expense.status === "rejected" ? "Rejected by" : "Approved by"}
              </span>
              <span className="font-semibold text-ink">{expense.approvedByName}</span>
            </div>
          )}
        </div>

        {expense.rejectReason && (
          <p className="rounded-[12px] bg-red-50 px-3 py-2 text-xs text-red-800">
            Rejected: {expense.rejectReason}
          </p>
        )}
        {expense.cancelReason && (
          <p className="rounded-[12px] bg-[#f3e6d2] px-3 py-2 text-xs text-[#8a6a3c]">
            Cancelled: {expense.cancelReason}
          </p>
        )}

        {/* The ledger rows this document produced — two for a Mixed payment,
            plus their reversals once cancelled. */}
        {entries.length > 0 && (
          <div>
            <h3 className={headCls}>On the cash book</h3>
            <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white">
              {entries.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5 text-xs first:border-t-0"
                >
                  <span className="text-ink-muted">
                    {dayLabel(c.onDate)} · {c.account === "cash" ? "Cash" : "Bank"} ·{" "}
                    {c.paymentMode}
                  </span>
                  <span
                    className={`font-bold tabular-nums ${
                      c.direction === "in" ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {c.direction === "in" ? "+" : "−"}
                    {money(c.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className={headCls}>History</h3>
          <ol className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id} className="border-l-2 border-line pl-2.5">
                <p className="text-xs font-semibold text-ink">
                  {EVENT_LABEL[ev.event]}
                  <span className="ml-1.5 font-normal text-ink-muted">
                    {ev.actorName} · {stamp(ev.at)}
                  </span>
                </p>
                {ev.event === "edited" &&
                  diffLines(ev.detail).map((line) => (
                    <p key={line} className="text-[11px] text-ink-muted">
                      {line}
                    </p>
                  ))}
                {typeof ev.detail.reason === "string" && (
                  <p className="text-[11px] italic text-ink-muted">
                    “{ev.detail.reason}”
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button onClick={() => onEdit(expense)} className={`${btnCls} text-ink`}>
              <Pencil size={13} /> Edit
            </button>
          )}
          {canTransition(expense.status, "paid", perms) && (
            <>
              <button
                disabled={busy || !!payShortfall}
                onClick={pay}
                className="inline-flex items-center gap-1.5 rounded-[11px] bg-brown px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Approve &amp; pay
              </button>
              {payShortfall && (
                <p className="w-full rounded-[11px] bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">
                  {payShortfall} Take money in, or move some from the other
                  account, before paying this.
                </p>
              )}
            </>
          )}
          {canTransition(expense.status, "rejected", perms) && (
            <button disabled={busy} onClick={reject} className={`${btnCls} text-red-700`}>
              <X size={13} /> Reject
            </button>
          )}
          {canTransition(expense.status, "cancelled", perms) && (
            <button disabled={busy} onClick={cancel} className={`${btnCls} text-red-700`}>
              <Ban size={13} /> Cancel &amp; reverse
            </button>
          )}
          {perms.canCancel &&
            (expense.status === "pending" || expense.status === "rejected") &&
            (confirmRemove ? (
              <div className="flex w-full items-center gap-2 rounded-[11px] border border-line bg-cream/60 px-3 py-2">
                <span className="flex-1 text-[11.5px] text-ink-muted">
                  Remove expense #{expense.expenseNo}? This cannot be undone.
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                  className="shrink-0 rounded-lg border border-line bg-warm-white px-2.5 py-1 text-[11.5px] font-bold text-ink-muted disabled:opacity-60"
                >
                  Keep
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={remove}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-danger px-2.5 py-1 text-[11.5px] font-bold text-warm-white disabled:opacity-60"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  Remove
                </button>
              </div>
            ) : (
              <button
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
                className={`${btnCls} text-red-700`}
              >
                <Trash2 size={13} /> Remove
              </button>
            ))}
        </div>
      </div>
    </Modal>
  );
}
