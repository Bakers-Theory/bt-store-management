"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { toCsv } from "@/lib/attendance";
import {
  MONTHS,
  PAYROLL_REPORT_HEADER,
  SALARY_MODES,
  isOverridden,
  missingDays,
  payrollReportRows,
  payrollTotals,
  periodLabel,
  periodSlug,
  round2,
  withGaps,
} from "@/lib/salary";
import {
  fetchPayroll,
  rpcDeleteSalaryPayment,
  rpcMarkSalaryPaid,
  rpcMarkSalaryUnpaid,
  rpcSaveSalaryPayment,
} from "@/lib/supabase-data";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { localDay } from "@/components/feature/attendance/AttendanceDay";
import { download } from "./download";
import type { PayrollRow, SalaryMode } from "@/lib/types";

const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

export function PayrollMonth({
  canEdit,
  canPay,
}: {
  canEdit: boolean;
  canPay: boolean;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const bakeryName = useBakeryStore((s) => s.bakery.name);
  const toast = useUIStore((s) => s.toast);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<PayrollRow | null>(null);
  const [overrideFor, setOverrideFor] = useState<PayrollRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async () => {
    setRows(await fetchPayroll(year, month));
  }, [year, month]);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchPayroll(year, month)
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
  }, [year, month, retry]);

  const totals = payrollTotals(rows);
  const gaps = withGaps(rows);
  const onPayroll = rows.filter((r) => r.gross > 0);
  const noSalary = rows.filter((r) => r.gross <= 0);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      if (ok) toast(ok, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(null);
    }
  };

  const createFor = (r: PayrollRow) =>
    act(r.profileId, () => rpcSaveSalaryPayment(r.profileId, year, month), "Payroll prepared");

  /** Prepare every employee that doesn't have a record yet, one at a time. */
  const createAll = async () => {
    const pending = onPayroll.filter((r) => r.status === "none");
    setBusy("all");
    let failed = 0;
    for (const r of pending) {
      try {
        await rpcSaveSalaryPayment(r.profileId, year, month);
      } catch {
        failed += 1;
      }
    }
    try {
      await reload();
    } catch {
      /* the toast below still reports the outcome */
    }
    setBusy(null);
    if (failed) toast(`${failed} could not be prepared`, "error");
    else toast(`Prepared ${pending.length} payroll records`, "success");
  };

  const baseName = `${(bakeryName || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-")}_salary_${periodSlug(year, month)}`;

  const exportCsv = () => {
    if (!onPayroll.length) {
      toast("Nobody on the payroll for this month", "error");
      return;
    }
    download(
      `${baseName}.csv`,
      toCsv([PAYROLL_REPORT_HEADER, ...payrollReportRows(rows, year, month)]),
      "text/csv",
    );
  };

  const exportExcel = async () => {
    if (!onPayroll.length) {
      toast("Nobody on the payroll for this month", "error");
      return;
    }
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          PAYROLL_REPORT_HEADER,
          ...payrollReportRows(rows, year, month),
        ]),
        "Salary",
      );
      XLSX.writeFile(wb, `${baseName}.xlsx`);
    } catch {
      toast("Could not build the Excel file", "error");
    } finally {
      setExporting(false);
    }
  };

  const money = (n: number) => `${currency}${n.toFixed(2)}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={selectCls}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Payroll month"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Payroll year"
        >
          {[0, 1, 2, 3].map((back) => {
            const y = now.getFullYear() - back;
            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </select>
        {canEdit && loaded && !error && totals.notCreated > 0 && (
          <button
            type="button"
            onClick={createAll}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#f4e7d2] px-3 py-[7px] text-[12.5px] font-bold text-brown disabled:opacity-60"
          >
            {busy === "all" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Prepare {totals.notCreated} record{totals.notCreated === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* Totals */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["On payroll", String(totals.employees)],
          ["Gross", money(totals.gross)],
          ["Deductions", money(totals.deduction)],
          ["Net", money(totals.net)],
          ["Paid", `${totals.paid} / ${totals.employees}`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[14px] border border-line bg-warm-white p-3 text-center"
          >
            <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
            <div className="num mt-1 text-[15px] font-extrabold text-ink">
              {loaded ? value : "—"}
            </div>
          </div>
        ))}
      </div>

      {/*
        The single most important control on this screen. With no "absent"
        status, an unmarked day deducts nothing — so an incomplete month
        understates deductions and overpays. Warn, don't block: a mid-month
        advance is legitimate.
      */}
      {loaded && !error && gaps.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[14px] border border-[#f0e2c2] bg-warn-bg p-3.5">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" />
          <div className="text-[12.5px] text-ink-muted">
            <span className="font-bold text-warn">
              Attendance is incomplete for {gaps.length} employee
              {gaps.length === 1 ? "" : "s"} in {periodLabel(year, month)}.
            </span>{" "}
            Unrecorded days don&apos;t deduct anything, so these figures may be
            higher than they should be. Finish marking the month first:{" "}
            {gaps
              .slice(0, 4)
              .map((r) => `${r.employeeName} (${missingDays(r)} days)`)
              .join(", ")}
            {gaps.length > 4 ? `, +${gaps.length - 4} more` : ""}.
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={exportExcel}
          disabled={exporting || !loaded}
          className="inline-flex items-center gap-1.5 rounded-[9px] bg-success px-3 py-[7px] text-[12.5px] font-bold text-warm-white disabled:opacity-60"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Excel
        </button>
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
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-[14px]" />
          ))}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          <p className="mb-3">Couldn&apos;t load the payroll.</p>
          <button
            type="button"
            onClick={() => setRetry((t) => t + 1)}
            className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
          >
            Retry
          </button>
        </div>
      ) : onPayroll.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          Nobody has a salary set yet — add one on the Salaries tab.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {onPayroll.map((r) => {
            const isBusy = busy === r.profileId || busy === "all";
            const gap = missingDays(r);
            const net = r.net ?? r.computedNet;
            return (
              <div
                key={r.profileId}
                className="rounded-[14px] border border-line bg-warm-white p-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.04)]"
              >
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

                {isOverridden(r) && (
                  <div className="mb-2.5 text-[11.5px] font-semibold text-warn">
                    Overridden from {money(r.computedNet)}
                  </div>
                )}
                {r.status === "paid" && r.paidOn && (
                  <div className="mb-2.5 text-[11.5px] text-ink-light">
                    Paid {r.paidOn} by {r.paymentMode}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-line-soft pt-2.5">
                  {isBusy && <Loader2 size={15} className="animate-spin text-ink-light" />}
                  {r.status === "none" && canEdit && (
                    <button
                      type="button"
                      onClick={() => createFor(r)}
                      disabled={isBusy}
                      className="rounded-lg bg-brown px-3 py-1.5 text-[12px] font-bold text-warm-white disabled:opacity-60"
                    >
                      Prepare
                    </button>
                  )}
                  {r.status === "unpaid" && canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => setOverrideFor(r)}
                        disabled={isBusy}
                        className="rounded-lg border border-line bg-warm-white px-3 py-1.5 text-[12px] font-bold text-ink-muted disabled:opacity-60"
                      >
                        Adjust net
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          act(
                            r.profileId,
                            () => rpcDeleteSalaryPayment(r.paymentId!),
                            "Record removed",
                          )
                        }
                        disabled={isBusy}
                        aria-label={`Remove payroll record for ${r.employeeName}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-danger-bg px-2.5 py-1.5 text-[12px] font-bold text-danger disabled:opacity-60"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                  {r.status === "unpaid" && canPay && (
                    <button
                      type="button"
                      onClick={() => setPayFor(r)}
                      disabled={isBusy}
                      className="rounded-lg bg-success px-3 py-1.5 text-[12px] font-bold text-warm-white disabled:opacity-60"
                    >
                      Mark paid
                    </button>
                  )}
                  {r.status === "paid" && canPay && (
                    <button
                      type="button"
                      onClick={() =>
                        act(r.profileId, () => rpcMarkSalaryUnpaid(r.paymentId!), "Reopened")
                      }
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-warm-white px-3 py-1.5 text-[12px] font-bold text-ink-muted disabled:opacity-60"
                    >
                      <RotateCcw size={13} /> Reopen
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {noSalary.length > 0 && (
            <p className="mt-1 text-center text-[12px] text-ink-light">
              {noSalary.length} staff member{noSalary.length === 1 ? "" : "s"} with no
              salary set {noSalary.length === 1 ? "is" : "are"} not on this payroll.
            </p>
          )}
        </div>
      )}

      {payFor && (
        <MarkPaidModal
          row={payFor}
          currency={currency}
          onClose={() => setPayFor(null)}
          onDone={async (paidOn, mode) => {
            setPayFor(null);
            await act(
              payFor.profileId,
              () => rpcMarkSalaryPaid(payFor.paymentId!, paidOn, mode),
              `Marked paid for ${payFor.employeeName}`,
            );
          }}
        />
      )}

      {overrideFor && (
        <OverrideModal
          row={overrideFor}
          currency={currency}
          onClose={() => setOverrideFor(null)}
          onDone={async (net, reason) => {
            const target = overrideFor;
            setOverrideFor(null);
            await act(
              target.profileId,
              () => rpcSaveSalaryPayment(target.profileId, year, month, net, reason),
              "Net pay adjusted",
            );
          }}
        />
      )}
    </>
  );
}

function MarkPaidModal({
  row,
  currency,
  onClose,
  onDone,
}: {
  row: PayrollRow;
  currency: string;
  onClose: () => void;
  onDone: (paidOn: string, mode: SalaryMode) => void;
}) {
  const today = localDay();
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<SalaryMode>("Cash");

  return (
    <Modal title={`Pay ${row.employeeName}`} onClose={onClose}>
      <div className="mb-3.5 rounded-[11px] bg-cream p-3 text-center">
        <div className="text-[11px] font-semibold text-ink-muted">Net payable</div>
        <div className="num text-xl font-extrabold text-ink">
          {currency}
          {(row.net ?? row.computedNet).toFixed(2)}
        </div>
      </div>
      <div className="mb-3.5">
        <label className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">Payment date *</label>
        <input
          type="date"
          value={paidOn}
          max={today}
          onChange={(e) => setPaidOn(e.target.value || today)}
          className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown"
        />
      </div>
      <div className="mb-3.5">
        <label className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">Payment mode *</label>
        <div className="grid grid-cols-2 gap-1.5">
          {SALARY_MODES.map((m) => (
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
        onClick={() => onDone(paidOn, mode)}
        disabled={!paidOn}
        className="w-full rounded-xl bg-success p-3 text-sm font-bold text-warm-white disabled:opacity-60"
      >
        Confirm payment
      </button>
    </Modal>
  );
}

function OverrideModal({
  row,
  currency,
  onClose,
  onDone,
}: {
  row: PayrollRow;
  currency: string;
  onClose: () => void;
  onDone: (net: number | null, reason: string) => void;
}) {
  const [amount, setAmount] = useState(String(row.net ?? row.computedNet));
  const [reason, setReason] = useState(row.status === "unpaid" ? "" : "");

  const parsed = round2(parseFloat(amount) || 0);
  const changed = parsed !== round2(row.computedNet);
  // The DB enforces this too; asking here avoids a round-trip to be told off.
  const needsReason = changed && reason.trim().length === 0;

  return (
    <Modal title={`Adjust net pay — ${row.employeeName}`} onClose={onClose}>
      <p className="mb-3.5 text-[12.5px] text-ink-muted">
        Attendance gives{" "}
        <span className="num font-bold text-ink">
          {currency}
          {row.computedNet.toFixed(2)}
        </span>{" "}
        ({currency}
        {row.gross.toFixed(2)} gross − {currency}
        {row.deduction.toFixed(2)} for {row.unpaidDays} unpaid day
        {row.unpaidDays === 1 ? "" : "s"}). Change it only with a reason — the
        original figure is kept alongside.
      </p>
      <div className="mb-3.5">
        <label className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">Net pay ({currency})</label>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown"
        />
      </div>
      <div className="mb-3.5">
        <label className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">
          Reason {changed ? "*" : "(not needed)"}
        </label>
        <input
          type="text"
          value={reason}
          disabled={!changed}
          placeholder="e.g. advance already paid, festival bonus"
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown disabled:opacity-60"
        />
      </div>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => onDone(null, "")}
          className="btn-secondary flex-1"
          title="Discard the override and use the calculated figure"
        >
          Reset to calculated
        </button>
        <button
          type="button"
          onClick={() => onDone(parsed, reason.trim())}
          disabled={needsReason || parsed < 0}
          className="flex-1 rounded-xl bg-brown p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
