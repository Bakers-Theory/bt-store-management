"use client";

import { useEffect, useMemo, useState } from "react";
import { useUIStore } from "@/lib/ui-store";
import {
  ATTENDANCE_STATUSES,
  STATUS_META,
  tally,
  unpaidDays,
} from "@/lib/attendance";
import { MONTHS, calendarDays } from "@/lib/salary";
import { fetchAttendance } from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Attendance, AttendanceStatus, Employee } from "@/lib/types";

const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

/** Compact cell colours — the grid is dense, so these carry the pattern. */
const CELL: Record<AttendanceStatus, string> = {
  present:  "bg-success-bg text-success",
  half_day: "bg-warn-bg text-warn",
  leave:    "bg-danger-bg text-danger",
  holiday:  "bg-[#e7e0f4] text-[#5b46a0]",
};

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * One row per employee, one column per day of the month. Deliberately generous
 * with the roster: an employee with nothing recorded still gets a row, because
 * an all-blank row is exactly the gap this view exists to make obvious.
 *
 * A high fetch limit rather than the history screen's 500: a full month across a
 * sizeable roster is legitimately more than that, and a truncated grid would
 * silently read as absence.
 */
export function AttendanceMonth({ employees }: { employees: Employee[] }) {
  const toast = useUIStore((s) => s.toast);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  const days = calendarDays(year, month);
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(days)}`;

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchAttendance({ from, to, profileId: null, status: null }, 4000)
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
  }, [from, to, retry]);

  /** profileId → day-of-month → record. */
  const byEmployee = useMemo(() => {
    const map = new Map<string, Map<number, Attendance>>();
    for (const r of records) {
      const day = Number(r.date.slice(8, 10));
      if (!map.has(r.profileId)) map.set(r.profileId, new Map());
      map.get(r.profileId)!.set(day, r);
    }
    return map;
  }, [records]);

  const dayNumbers = Array.from({ length: days }, (_, i) => i + 1);
  const isFuture = (day: number) =>
    new Date(year, month - 1, day) > new Date(new Date().toDateString());

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={selectCls}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Month"
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
          aria-label="Year"
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

        {/* Legend — the codes are unreadable without it. */}
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold">
          {ATTENDANCE_STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-[6px] text-[10.5px] font-bold ${CELL[s]}`}
              >
                {STATUS_META[s].short}
              </span>
              <span className="text-ink-muted">{STATUS_META[s].label}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-cream text-[10.5px] font-bold text-ink-light">
              ·
            </span>
            <span className="text-ink-muted">Not marked</span>
          </span>
        </div>
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          <p className="mb-3">Couldn&apos;t load the month.</p>
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
          No staff yet — add people under Settings → Staff first.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-warm-white">
          <table className="border-separate border-spacing-0 text-[11.5px]">
            <thead>
              <tr>
                {/* Sticky so the name stays visible while scrolling 31 columns. */}
                <th className="sticky left-0 z-10 border-b border-line-soft bg-warm-white px-3 py-2 text-left text-[10.5px] font-bold tracking-[.06em] text-line-strong">
                  EMPLOYEE
                </th>
                {dayNumbers.map((d) => {
                  const dow = new Date(year, month - 1, d).getDay();
                  const weekend = dow === 0;
                  return (
                    <th
                      key={d}
                      className={`border-b border-line-soft px-0 py-1.5 text-center font-bold ${
                        weekend ? "bg-cream text-brown" : "text-ink-light"
                      }`}
                      style={{ minWidth: 26 }}
                    >
                      <div className="text-[10px] leading-tight">{WEEKDAY[dow]}</div>
                      <div className="text-[11px] leading-tight">{d}</div>
                    </th>
                  );
                })}
                <th className="border-b border-l border-line-soft px-2 py-2 text-right text-[10.5px] font-bold tracking-[.06em] text-line-strong">
                  REC
                </th>
                <th className="border-b border-line-soft px-2 py-2 text-right text-[10.5px] font-bold tracking-[.06em] text-line-strong">
                  UNPAID
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const row = byEmployee.get(e.id) ?? new Map<number, Attendance>();
                const mine = [...row.values()];
                const unpaid = unpaidDays(tally(mine));
                return (
                  <tr key={e.id}>
                    <td className="sticky left-0 z-10 border-b border-line-soft bg-warm-white px-3 py-1.5 font-bold">
                      <span className="block max-w-[140px] truncate">{e.name}</span>
                    </td>
                    {dayNumbers.map((d) => {
                      const rec = row.get(d);
                      const dow = new Date(year, month - 1, d).getDay();
                      return (
                        <td
                          key={d}
                          className={`border-b border-line-soft p-[3px] text-center ${
                            dow === 0 && !rec ? "bg-cream/60" : ""
                          }`}
                          title={
                            rec
                              ? `${e.name} · ${rec.date} · ${STATUS_META[rec.status].label}${rec.note ? ` — ${rec.note}` : ""}`
                              : `${e.name} · ${year}-${pad(month)}-${pad(d)} · not marked`
                          }
                        >
                          {rec ? (
                            <span
                              className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-[6px] font-bold ${CELL[rec.status]}`}
                            >
                              {STATUS_META[rec.status].short}
                            </span>
                          ) : (
                            <span
                              className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-[6px] font-bold ${
                                isFuture(d) ? "text-line" : "bg-cream text-ink-light"
                              }`}
                            >
                              ·
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num border-b border-l border-line-soft px-2 py-1.5 text-right font-semibold">
                      {mine.length}
                    </td>
                    <td
                      className={`num border-b border-line-soft px-2 py-1.5 text-right font-bold ${
                        unpaid > 0 ? "text-danger" : "text-ink-light"
                      }`}
                    >
                      {unpaid}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loaded && !error && employees.length > 0 && (
        <p className="mt-3 text-center text-[12px] text-ink-light">
          Sundays are shaded. Unmarked days deduct nothing — the{" "}
          <span className="font-semibold">unpaid</span> column is what payroll
          charges for. Mark or correct a day on the{" "}
          <span className="font-semibold">Mark day</span> tab.
        </p>
      )}
    </>
  );
}
