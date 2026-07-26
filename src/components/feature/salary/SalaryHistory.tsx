"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { toCsv } from "@/lib/attendance";
import { periodLabel, periodSlug, round2 } from "@/lib/salary";
import { fetchEmployees, fetchSalaryPayments } from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import { download } from "./download";
import type { Employee, SalaryPayment } from "@/lib/types";

const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

export function SalaryHistory() {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const bakeryName = useBakeryStore((s) => s.bakery.name);
  const toast = useUIStore((s) => s.toast);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [profileId, setProfileId] = useState("");
  const [rows, setRows] = useState<SalaryPayment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  // Best-effort: the filter is a convenience, so a failed roster fetch must not
  // block the history itself.
  useEffect(() => {
    let alive = true;
    fetchEmployees()
      .then((r) => alive && setEmployees(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchSalaryPayments(profileId || null)
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
  }, [profileId, retry]);

  const paidTotal = round2(
    rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.net, 0),
  );

  const exportCsv = () => {
    if (!rows.length) {
      toast("Nothing to export", "error");
      return;
    }
    const name = `${(bakeryName || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-")}_salary_history`;
    download(
      `${name}.csv`,
      toCsv([
        ["Period", "Employee", "Gross", "Unpaid days", "Deduction", "Net", "Status", "Paid on", "Mode", "Reason", "Recorded by"],
        ...rows.map((r) => [
          periodSlug(r.periodYear, r.periodMonth),
          r.employeeName,
          r.gross,
          r.unpaidDays,
          r.deduction,
          r.net,
          r.status,
          r.paidOn ?? "",
          r.paymentMode,
          r.overrideReason,
          r.recordedByName,
        ]),
      ]),
      "text/csv",
    );
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={selectCls}
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          aria-label="Filter by employee"
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!loaded}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-warm-white px-3 py-[7px] text-[12.5px] font-bold text-ink-muted disabled:opacity-60"
        >
          <Download size={15} /> CSV
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!loaded}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-warm-white px-3 py-[7px] text-[12.5px] font-bold text-ink-muted disabled:opacity-60"
        >
          <Printer size={15} /> Print / PDF
        </button>
        {loaded && !error && rows.length > 0 && (
          <span className="ml-auto text-[12.5px] font-semibold text-ink-muted">
            Paid to date:{" "}
            <span className="num font-extrabold text-ink">
              {currency}
              {paidTotal.toFixed(2)}
            </span>
          </span>
        )}
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-[14px]" />
          ))}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          <p className="mb-3">Couldn&apos;t load payment history.</p>
          <button
            type="button"
            onClick={() => setRetry((t) => t + 1)}
            className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          No payroll records yet. Prepare a month on the Payroll tab.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold">
                  {r.employeeName}
                  <span className="ml-2 font-semibold text-ink-light">
                    {periodLabel(r.periodYear, r.periodMonth)}
                  </span>
                </div>
                <div className="text-[11.5px] text-ink-light">
                  {currency}
                  {r.gross.toFixed(2)} gross
                  {r.deduction > 0 ? ` − ${currency}${r.deduction.toFixed(2)}` : ""}
                  {r.status === "paid" && r.paidOn ? ` · ${r.paidOn} · ${r.paymentMode}` : ""}
                  {r.recordedByName ? ` · by ${r.recordedByName}` : ""}
                </div>
                {r.overrideReason && (
                  <div className="text-[11px] font-semibold text-warn">
                    Adjusted from {currency}
                    {r.computedNet.toFixed(2)} — {r.overrideReason}
                  </div>
                )}
              </div>
              <div className="num shrink-0 text-right text-[15px] font-extrabold text-ink">
                {currency}
                {r.net.toFixed(2)}
              </div>
              <span
                className={`shrink-0 rounded-full px-[11px] py-1 text-[11px] font-bold ${
                  r.status === "paid" ? "bg-success-bg text-success" : "bg-warn-bg text-warn"
                }`}
              >
                {r.status === "paid" ? "Paid" : "Unpaid"}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
