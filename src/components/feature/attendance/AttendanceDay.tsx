"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, Loader2, X } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";
import { initials } from "@/lib/format";
import {
  ATTENDANCE_STATUSES,
  STATUS_META,
  unmarkedCount,
} from "@/lib/attendance";
import {
  fetchAttendanceForDate,
  rpcClearAttendance,
  rpcSetAttendance,
} from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Attendance, AttendanceStatus, Employee } from "@/lib/types";

/** Local calendar day as YYYY-MM-DD — never a UTC-shifted `toISOString()`. */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TONE: Record<AttendanceStatus, string> = {
  present:  "bg-success-bg text-success border-[#cfe6d3]",
  half_day: "bg-warn-bg text-warn border-[#f0e2c2]",
  leave:    "bg-cream-dark text-brown border-line",
  holiday:  "bg-[#e7e0f4] text-[#5b46a0] border-[#d6cbee]",
};

export function AttendanceDay({
  employees,
  canEdit,
}: {
  employees: Employee[];
  canEdit: boolean;
}) {
  const toast = useUIStore((s) => s.toast);
  const today = localDay();

  const [date, setDate] = useState(today);
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // Per-employee, so marking one person doesn't disable the whole roster.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const setBusyFor = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchAttendanceForDate(date)
      .then((rows) => {
        if (!alive) return;
        setRecords(rows);
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
  }, [date, retry]);

  const byProfile = useMemo(
    () => new Map(records.map((r) => [r.profileId, r])),
    [records],
  );

  const mark = useCallback(
    async (employee: Employee, status: AttendanceStatus) => {
      setBusyFor(employee.id, true);
      try {
        const row = await rpcSetAttendance(employee.id, date, status);
        // Upsert locally: the RPC returns the stored row either way, so one
        // reconcile handles both "first mark" and "correction".
        setRecords((prev) => [
          ...prev.filter((r) => r.profileId !== employee.id),
          row,
        ]);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not save attendance", "error");
      } finally {
        setBusyFor(employee.id, false);
      }
    },
    [date, toast],
  );

  const clear = useCallback(
    async (employee: Employee) => {
      setBusyFor(employee.id, true);
      try {
        await rpcClearAttendance(employee.id, date);
        setRecords((prev) => prev.filter((r) => r.profileId !== employee.id));
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not clear attendance", "error");
      } finally {
        setBusyFor(employee.id, false);
      }
    },
    [date, toast],
  );

  const pending = unmarkedCount(
    employees.map((e) => e.id),
    records,
  );

  /**
   * Fill in only the people with no record yet — never overwrite a status
   * someone deliberately set. Sequential rather than parallel so a partial
   * failure leaves a coherent state and the error is attributable.
   */
  const markAllPresent = async () => {
    setBulkBusy(true);
    let failed = 0;
    for (const e of employees) {
      if (byProfile.has(e.id)) continue;
      try {
        const row = await rpcSetAttendance(e.id, date, "present");
        setRecords((prev) => [...prev.filter((r) => r.profileId !== e.id), row]);
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    if (failed) toast(`${failed} could not be marked`, "error");
    else toast("Marked everyone present", "success");
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <label className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">Date</label>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
            className="rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown"
          />
        </div>
        {date !== today && (
          <button
            type="button"
            onClick={() => setDate(today)}
            className="mt-5 rounded-full border border-line bg-warm-white px-3.5 py-1.5 text-[12.5px] font-bold text-ink-muted"
          >
            Back to today
          </button>
        )}
        {canEdit && pending > 0 && loaded && !error && (
          <button
            type="button"
            onClick={markAllPresent}
            disabled={bulkBusy}
            className="mt-5 inline-flex items-center gap-1.5 rounded-[9px] bg-[#f4e7d2] px-3 py-[7px] text-[12.5px] font-bold text-brown disabled:opacity-60"
          >
            {bulkBusy ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} />}
            Mark remaining {pending} present
          </button>
        )}
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-[14px] border border-line bg-warm-white p-3.5">
              <div className="flex items-center gap-[11px]">
                <Skeleton className="h-10 w-10 rounded-[11px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          <p className="mb-3">Couldn&apos;t load attendance for this day.</p>
          <button
            type="button"
            onClick={() => setRetry((t) => t + 1)}
            className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
          >
            Retry
          </button>
        </div>
      ) : employees.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          No staff to mark yet — add people under Settings → Staff first.
          <br />
          <span className="text-[12px] text-ink-light">
            The Owner isn&apos;t listed here.
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {employees.map((e) => {
            const rec = byProfile.get(e.id);
            const isBusy = busy.has(e.id) || bulkBusy;
            return (
              <div
                key={e.id}
                className="rounded-[14px] border border-line bg-warm-white p-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.04)]"
              >
                <div className="mb-3 flex items-center gap-[11px]">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-cream-dark text-sm font-bold text-brown">
                    {initials(e.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{e.name}</div>
                    <div className="text-[11.5px] text-ink-light">
                      {rec
                        ? `${STATUS_META[rec.status].label}${rec.markedByName ? ` · by ${rec.markedByName}` : ""}`
                        : "Not marked — counts as absent"}
                    </div>
                  </div>
                  {isBusy && <Loader2 size={16} className="animate-spin text-ink-light" />}
                  {rec && canEdit && !isBusy && (
                    <button
                      type="button"
                      onClick={() => clear(e)}
                      aria-label={`Clear attendance for ${e.name}`}
                      title="Clear"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-warm-white text-ink-light"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {ATTENDANCE_STATUSES.map((s) => {
                    const on = rec?.status === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={!canEdit || isBusy}
                        aria-pressed={on}
                        onClick={() => mark(e, s)}
                        className={`rounded-[10px] border px-1 py-2 text-[11.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          on ? TONE[s] : "border-line bg-cream text-ink-muted"
                        }`}
                      >
                        {STATUS_META[s].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canEdit && loaded && !error && employees.length > 0 && (
        <p className="mt-4 text-center text-[12px] text-ink-light">
          Leave a day unmarked to record an absence — clearing a record and
          marking someone absent are the same thing.
        </p>
      )}
      {!canEdit && loaded && !error && employees.length > 0 && (
        <p className="mt-4 rounded-xl bg-cream p-3 text-center text-[12.5px] font-semibold text-ink-muted">
          You can view attendance but not change it.
        </p>
      )}
    </>
  );
}
