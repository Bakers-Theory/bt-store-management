"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ATTENDANCE_STATUSES,
  STATUS_META,
  tally,
  unpaidDays,
} from "@/lib/attendance";
import { MONTHS, calendarDays } from "@/lib/salary";
import { fetchAttendance } from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Attendance, AttendanceStatus } from "@/lib/types";

/** Cell colours — the calendar reads as a pattern first, letters second. */
const CELL: Record<AttendanceStatus, string> = {
  present:  "bg-success-bg text-success",
  half_day: "bg-warn-bg text-warn",
  leave:    "bg-danger-bg text-danger",
  holiday:  "bg-[#e7e0f4] text-[#5b46a0]",
};

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * One employee's month as an actual calendar, next to the panel that marks it:
 * it is the date picker for that panel, and the month-at-a-glance record for
 * whoever the chip row has selected. A calendar has a single cell per date, so
 * this view is per-person by design. An unmarked day is still drawn, because a
 * blank square in a week is exactly the gap this view exists to make obvious.
 */
export function AttendanceMonth({
  employeeId,
  selected,
  onSelect,
  version,
}: {
  /** Whose month this is — shared with the marking panel. */
  employeeId: string;
  /** The date the panel is showing — ISO, controlled by the parent. */
  selected: string;
  onSelect: (date: string) => void;
  /** Changes whenever a day is saved below, to re-read the month. */
  version: number;
}) {
  const now = new Date();
  // Opens on the selected day's month, then navigates independently of it.
  const [year, setYear] = useState(() => Number(selected.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(selected.slice(5, 7)));
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  const days = calendarDays(year, month);
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(days)}`;

  // Which month/employee is on screen. A refetch that isn't a change of these —
  // i.e. a save below — keeps the grid up rather than flashing a skeleton.
  const shape = `${from}|${to}|${employeeId}`;
  const shownShape = useRef("");

  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    if (shownShape.current !== shape) {
      shownShape.current = shape;
      setLoaded(false);
    }
    setError(false);
    fetchAttendance({ from, to, profileId: employeeId, status: null }, 100)
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
  }, [from, to, employeeId, shape, retry, version]);

  /** day-of-month → record. */
  const byDay = useMemo(() => {
    const map = new Map<number, Attendance>();
    for (const r of records) map.set(Number(r.date.slice(8, 10)), r);
    return map;
  }, [records]);

  const counts = tally(records);
  const unpaid = unpaidDays(counts);

  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const thisMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  /** Move `by` months, rolling the year over. Forward stops at this month. */
  const step = (by: number) => {
    const d = new Date(year, month - 1 + by, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  // Blank cells before the 1st so the month starts on its real weekday.
  const lead = new Date(year, month - 1, 1).getDay();
  const dayNumbers = Array.from({ length: days }, (_, i) => i + 1);

  // One element, not a fragment: the parent lays this out as a single grid
  // cell, and loose children would each be placed as a cell of their own.
  return (
    <div className="min-w-0">
      {/* With no roster there's nothing to draw — the panel beside says why. */}
      {!employeeId ? null : !loaded ? (
        <Skeleton className="h-[360px] rounded-[18px]" />
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
      ) : (
        <>
          <div className="w-full rounded-[18px] border border-line bg-warm-white p-3 shadow-[0_2px_12px_rgba(100,60,20,0.04)]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous month"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-warm-white text-ink-muted"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-bold">
                  {MONTHS[month - 1]} {year}
                </span>
                {!thisMonth && (
                  <button
                    type="button"
                    onClick={() => {
                      setYear(now.getFullYear());
                      setMonth(now.getMonth() + 1);
                    }}
                    className="rounded-full bg-cream-dark px-2 py-[3px] text-[10.5px] font-bold text-brown"
                  >
                    This month
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={thisMonth}
                aria-label="Next month"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-warm-white text-ink-muted disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAY.map((w, i) => (
                <div
                  key={i}
                  className={`text-center text-[10.5px] font-bold tracking-[.06em] ${
                    i === 0 ? "text-brown" : "text-line-strong"
                  }`}
                >
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: lead }, (_, i) => (
                <div key={`lead-${i}`} />
              ))}
              {dayNumbers.map((d) => {
                const iso = `${year}-${pad(month)}-${pad(d)}`;
                const rec = byDay.get(d);
                const future = iso > todayStr;
                const sunday = new Date(year, month - 1, d).getDay() === 0;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={future}
                    onClick={() => onSelect(iso)}
                    title={
                      rec
                        ? `${iso} · ${STATUS_META[rec.status].label}${rec.note ? ` — ${rec.note}` : ""}`
                        : `${iso} · not marked`
                    }
                    className={`flex aspect-square flex-col items-center justify-center gap-[1px] rounded-[9px] border text-center disabled:opacity-40 ${
                      rec
                        ? `border-transparent ${CELL[rec.status]}`
                        : sunday
                          ? "border-line-soft bg-cream text-ink-light"
                          : "border-line-soft bg-warm-white text-ink-light"
                    } ${
                      iso === selected
                        ? "!border-brown ring-2 ring-brown/25"
                        : iso === todayStr
                          ? "!border-line-strong"
                          : ""
                    }`}
                  >
                    <span className="text-[12.5px] font-bold leading-[1.15]">{d}</span>
                    <span className="text-[10.5px] font-bold leading-[1.15]">
                      {rec ? STATUS_META[rec.status].short : future ? "" : "·"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend doubles as the month tally — the counts are the point. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11.5px] font-semibold">
            {ATTENDANCE_STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-[6px] text-[10.5px] font-bold ${CELL[s]}`}
                >
                  {STATUS_META[s].short}
                </span>
                <span className="text-ink-muted">
                  {STATUS_META[s].label} {counts[s]}
                </span>
              </span>
            ))}
            <span className="text-ink-muted">
              Recorded <span className="num font-bold">{records.length}</span>
            </span>
            <span className={unpaid > 0 ? "text-danger" : "text-ink-muted"}>
              Unpaid <span className="num font-bold">{unpaid}</span>
            </span>
          </div>

          <p className="mt-2.5 text-[12px] text-ink-light">
            Tap a day to mark or correct it. Unmarked days deduct nothing —{" "}
            <span className="font-semibold">unpaid</span> is what payroll charges
            for.
          </p>
        </>
      )}
    </div>
  );
}
