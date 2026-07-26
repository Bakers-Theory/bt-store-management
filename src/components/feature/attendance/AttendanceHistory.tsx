"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";
import { useBakeryStore } from "@/lib/store";
import { formatDateFull } from "@/lib/format";
import {
  ATTENDANCE_STATUSES,
  STATUS_META,
  attendanceCsv,
  summaryCsv,
  totalsOf,
} from "@/lib/attendance";
import { fetchAttendance, fetchAttendanceSummary } from "@/lib/supabase-data";
import { DateRangeFilter } from "@/components/ui/DateRangePicker";
import { Skeleton } from "@/components/ui/Skeleton";
import { download } from "@/components/feature/salary/download";
import type {
  Attendance,
  AttendanceStatus,
  AttendanceSummary,
  Employee,
} from "@/lib/types";
import type { DateRange } from "@/lib/date-range";

const PAGE_LIMIT = 500;
const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

export function AttendanceHistory({ employees }: { employees: Employee[] }) {
  const toast = useUIStore((s) => s.toast);
  const bakeryName = useBakeryStore((s) => s.bakery.name);

  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [profileId, setProfileId] = useState("");
  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [records, setRecords] = useState<Attendance[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      profileId: profileId || null,
      status: status || null,
    }),
    [range.from, range.to, profileId, status],
  );

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    // The summary is server-computed over the whole range, so it stays correct
    // even when the detail list below is truncated at PAGE_LIMIT.
    Promise.all([
      fetchAttendance(filters, PAGE_LIMIT),
      fetchAttendanceSummary(filters.from, filters.to, filters.profileId),
    ])
      .then(([rows, sum]) => {
        if (!alive) return;
        setRecords(rows);
        // Drop employees with nothing in range unless one was asked for
        // explicitly — an all-zero row per person is noise.
        setSummary(filters.profileId ? sum : sum.filter((r) => r.recorded > 0));
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
  }, [filters, retry]);

  const totals = totalsOf(summary);
  const truncated = records.length === PAGE_LIMIT;

  const slug = (bakeryName || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const rangeLabel =
    range.from && range.to
      ? `${range.from}_to_${range.to}`
      : range.from
        ? `from_${range.from}`
        : range.to
          ? `until_${range.to}`
          : "all-time";
  const baseName = `${slug}_attendance_${rangeLabel}`;

  const exportCsv = () => {
    if (!records.length) {
      toast("Nothing to export for these filters", "error");
      return;
    }
    download(`${baseName}.csv`, attendanceCsv(records), "text/csv");
  };

  const exportSummaryCsv = () => {
    if (!summary.length) {
      toast("Nothing to export for these filters", "error");
      return;
    }
    download(`${baseName}_summary.csv`, summaryCsv(summary), "text/csv");
  };

  /** Excel keeps `xlsx` behind a dynamic import so it stays out of the bundle. */
  const exportExcel = async () => {
    if (!records.length) {
      toast("Nothing to export for these filters", "error");
      return;
    }
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          records.map((r) => ({
            Date: r.date,
            Employee: r.employeeName,
            Status: STATUS_META[r.status].label,
            Note: r.note,
            "Marked by": r.markedByName,
          })),
        ),
        "Attendance",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          summary.map((r) => ({
            Employee: r.employeeName,
            Present: r.present,
            "Half Day": r.halfDay,
            Leave: r.leave,
            Holiday: r.holiday,
            "Days recorded": r.recorded,
            "Payable days": r.payableDays,
          })),
        ),
        "Summary",
      );
      XLSX.writeFile(wb, `${baseName}.xlsx`);
    } catch {
      toast("Could not build the Excel file", "error");
    } finally {
      setExporting(false);
    }
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
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as AttendanceStatus | "")}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {ATTENDANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {/* Summary tiles — the Story 2 "attendance summary" */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Present", totals.present],
          ["Half Day", totals.halfDay],
          ["Leave", totals.leave],
          ["Holiday", totals.holiday],
          ["Days recorded", totals.recorded],
          ["Payable days", totals.payableDays],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-[14px] border border-line bg-warm-white p-3 text-center"
          >
            <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
            <div className="num mt-1 text-lg font-extrabold text-ink">
              {loaded ? value : "—"}
            </div>
          </div>
        ))}
      </div>

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
          onClick={exportSummaryCsv}
          disabled={!loaded}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-warm-white px-3 py-[7px] text-[12.5px] font-bold text-ink-muted disabled:opacity-60"
        >
          <Download size={15} /> Summary CSV
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

      {/* Per-employee summary */}
      {loaded && !error && summary.length > 0 && (
        <div className="mb-4 overflow-x-auto rounded-[18px] border border-line bg-warm-white">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] font-bold tracking-[.06em] text-line-strong">
                <th className="px-4 py-2.5">EMPLOYEE</th>
                {ATTENDANCE_STATUSES.map((s) => (
                  <th key={s} className="px-2 py-2.5 text-right">
                    {STATUS_META[s].short}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right">PAYABLE</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => (
                <tr key={r.profileId} className="border-t border-line-soft">
                  <td className="px-4 py-2.5 font-bold">{r.employeeName}</td>
                  <td className="num px-2 py-2.5 text-right">{r.present}</td>
                  <td className="num px-2 py-2.5 text-right">{r.halfDay}</td>
                  <td className="num px-2 py-2.5 text-right">{r.leave}</td>
                  <td className="num px-2 py-2.5 text-right">{r.holiday}</td>
                  <td className="num px-4 py-2.5 text-right font-bold">{r.payableDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail list */}
      {!loaded ? (
        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          <p className="mb-3">Couldn&apos;t load attendance history.</p>
          <button
            type="button"
            onClick={() => setRetry((t) => t + 1)}
            className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
          >
            Retry
          </button>
        </div>
      ) : records.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          No attendance recorded for these filters.
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
            {records.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold">{r.employeeName}</div>
                  <div className="text-[11.5px] text-ink-light">
                    {formatDateFull(r.date)}
                    {r.note ? ` · ${r.note}` : ""}
                    {r.markedByName ? ` · by ${r.markedByName}` : ""}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-cream-dark px-[11px] py-1 text-[11.5px] font-bold text-brown">
                  {STATUS_META[r.status].label}
                </span>
              </div>
            ))}
          </div>
          {truncated && (
            <p className="mt-3 text-center text-[12px] text-ink-light">
              Showing the {PAGE_LIMIT} most recent records. The summary above still
              covers the whole range — narrow the dates or pick one employee to see
              the rest.
            </p>
          )}
        </>
      )}
    </>
  );
}
