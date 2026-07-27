"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchAdvances } from "@/lib/supabase-data";
import type { AdvanceBalance, StaffAdvance } from "@/lib/types";

/** One employee's advance ledger — every request, and what became of it. */
export function AdvanceHistory({
  employee,
  currency,
  onClose,
}: {
  employee: AdvanceBalance;
  currency: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<StaffAdvance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

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
            </div>
          ))}
        </div>
      )}

      <p className="mt-3.5 text-center text-[11.5px] text-ink-light">
        Recovery happens on the Payroll tab, month by month.
      </p>
    </Modal>
  );
}
