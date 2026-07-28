"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchAdvances } from "@/lib/supabase-data";
import type { AdvanceBalance, StaffAdvance } from "@/lib/types";

/**
 * One employee's advance ledger — every request, and what became of it.
 *
 * `onDelete` is passed only to a holder of `advance.delete`; it removes a
 * decided (approved or rejected) record. Pending requests are acted on from the
 * approvals strip on the Advances tab, not here.
 */
export function AdvanceHistory({
  employee,
  currency,
  onClose,
  onDelete,
}: {
  employee: AdvanceBalance;
  currency: string;
  onClose: () => void;
  onDelete?: (advance: StaffAdvance) => Promise<void>;
}) {
  const [rows, setRows] = useState<StaffAdvance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  // Deleting a disbursement is not routine, so the trash icon arms a confirm
  // rather than firing straight away.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (a: StaffAdvance) => {
    if (!onDelete) return;
    setBusy(a.id);
    try {
      await onDelete(a);
      setRows((r) => r.filter((x) => x.id !== a.id));
      setConfirmId(null);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let alive = true;
    fetchAdvances(employee.profileId)
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [employee.profileId]);

  const money = (n: number) => `${currency}${n.toFixed(2)}`;

  return (
    <Modal title={`Advances — ${employee.employeeName}`} onClose={onClose}>
      <div className="mb-3.5 grid grid-cols-3 gap-2 rounded-[11px] bg-cream p-2.5 text-center">
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Advanced</div>
          <div className="num text-[13px] font-bold">{money(employee.totalAdvanced)}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Recovered</div>
          <div className="num text-[13px] font-bold">{money(employee.totalRecovered)}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Outstanding</div>
          <div className="num text-[13px] font-extrabold">{money(employee.balance)}</div>
        </div>
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-[11px]" />
          ))}
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          Couldn&apos;t load the advance history.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">No advances yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((a) => (
            <div key={a.id} className="rounded-[11px] border border-line bg-cream p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="num text-sm font-bold">{money(a.amount)}</div>
                  <div className="text-[11px] text-ink-light">
                    Requested {a.requestedOn}
                    {a.requestedByName ? ` by ${a.requestedByName}` : ""}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                    a.status === "approved"
                      ? "bg-success-bg text-success"
                      : a.status === "rejected"
                        ? "bg-danger-bg text-danger"
                        : "bg-warn-bg text-warn"
                  }`}
                >
                  {a.status === "approved"
                    ? "Approved"
                    : a.status === "rejected"
                      ? "Rejected"
                      : "Pending"}
                </span>
              </div>
              {a.note && <div className="mt-1 text-[11.5px] text-ink-muted">{a.note}</div>}
              {a.status === "approved" && a.approvedOn && (
                <div className="mt-1 text-[11px] text-ink-light">
                  Handed over {a.approvedOn} by {a.paymentMode}
                  {a.decidedByName ? ` · approved by ${a.decidedByName}` : ""}
                </div>
              )}
              {a.status === "rejected" && (
                <div className="mt-1 text-[11px] font-semibold text-danger">
                  {a.rejectReason}
                </div>
              )}
              {onDelete && a.status !== "pending" && (
                <div className="mt-2 flex items-center justify-end gap-2">
                  {busy === a.id && (
                    <Loader2 size={14} className="animate-spin text-ink-light" />
                  )}
                  {confirmId === a.id ? (
                    <>
                      <span className="mr-auto text-[11px] text-ink-muted">
                        {a.status === "approved"
                          ? "Delete this handed-over advance?"
                          : "Delete this rejected request?"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        disabled={busy !== null}
                        className="rounded-lg border border-line bg-warm-white px-2.5 py-1 text-[11.5px] font-bold text-ink-muted disabled:opacity-60"
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(a)}
                        disabled={busy !== null}
                        className="rounded-lg bg-danger px-2.5 py-1 text-[11.5px] font-bold text-warm-white disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(a.id)}
                      disabled={busy !== null}
                      aria-label={`Delete the ${money(a.amount)} advance from ${a.requestedOn}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-danger-bg px-2 py-1 text-[11.5px] font-bold text-danger disabled:opacity-60"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3.5 text-center text-[11.5px] text-ink-light">
        Recovery happens on the Payroll tab, month by month.
        {onDelete
          ? " An advance already recovered from a salary cannot be deleted — clear the recovery first."
          : ""}
      </p>
    </Modal>
  );
}
