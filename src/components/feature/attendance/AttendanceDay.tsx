"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";
import { ATTENDANCE_STATUSES, STATUS_META } from "@/lib/attendance";
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

/** "Mon, 27 Jul 2026" — parsed as a local date, not a UTC instant. */
function formatDayFull(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const TONE: Record<AttendanceStatus, string> = {
  present:  "bg-success-bg text-success border-[#cfe6d3]",
  half_day: "bg-warn-bg text-warn border-[#f0e2c2]",
  leave:    "bg-cream-dark text-brown border-line",
  holiday:  "bg-[#e7e0f4] text-[#5b46a0] border-[#d6cbee]",
};

/**
 * Marks one person on one day. Both are chosen elsewhere — the chip row picks
 * the person, the calendar picks the day — so this panel is purely the verdict:
 * four statuses, a note, and a way to undo.
 */
export function AttendanceDay({
  employee,
  canEdit,
  date,
  setDate,
  onChanged,
}: {
  /** Undefined only while the roster is empty. */
  employee: Employee | undefined;
  canEdit: boolean;
  /** Controlled by the parent — the calendar beside this is the picker. */
  date: string;
  setDate: (date: string) => void;
  /** Fired after a save so the calendar can re-read the month. */
  onChanged: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const today = localDay();
  const employeeId = employee?.id;

  const [record, setRecord] = useState<Attendance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  // null = not being edited, so the input falls back to the stored note.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    setLoaded(false);
    setError(false);
    setNoteDraft(null);
    fetchAttendanceForDate(date)
      .then((rows) => {
        if (!alive) return;
        setRecord(rows.find((r) => r.profileId === employeeId) ?? null);
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
  }, [date, employeeId, retry]);

  const mark = useCallback(
    async (status: AttendanceStatus, note = "") => {
      if (!employeeId) return;
      setBusy(true);
      try {
        // The RPC returns the stored row either way, so one reconcile handles
        // both "first mark" and "correction".
        setRecord(await rpcSetAttendance(employeeId, date, status, note));
        onChanged();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not save attendance", "error");
      } finally {
        setBusy(false);
      }
    },
    [employeeId, date, toast, onChanged],
  );

  /**
   * Save a note against an already-marked day. Re-sends the existing status
   * because `set_attendance` is a single upsert — the RPC recognises a
   * note-only change and logs it as such rather than as a status change.
   */
  const saveNote = useCallback(async () => {
    if (!record || noteDraft === null) return;
    const next = noteDraft.trim();
    setNoteDraft(null);
    if (next !== record.note.trim()) await mark(record.status, next);
  }, [record, noteDraft, mark]);

  const clear = useCallback(async () => {
    if (!employeeId) return;
    setBusy(true);
    try {
      await rpcClearAttendance(employeeId, date);
      setRecord(null);
      setNoteDraft(null);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not clear attendance", "error");
    } finally {
      setBusy(false);
    }
  }, [employeeId, date, toast, onChanged]);

  if (!employee) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        No staff to mark yet — add people under Settings → Staff first.
        <br />
        <span className="text-[12px] text-ink-light">
          The Owner isn&apos;t listed here.
        </span>
      </p>
    );
  }

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-4 shadow-[0_2px_12px_rgba(100,60,20,0.04)]">
      <div className="mb-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-bold">{formatDayFull(date)}</h3>
            {date === today && (
              <span className="shrink-0 rounded-full bg-cream-dark px-2 py-[3px] text-[10.5px] font-bold text-brown">
                Today
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-light">
            {employee.name}
            {loaded && !error && (
              <>
                {" · "}
                {record
                  ? `${STATUS_META[record.status].label}${record.markedByName ? ` by ${record.markedByName}` : ""}`
                  : "Not marked — counts as absent"}
              </>
            )}
          </p>
        </div>
        {busy && <Loader2 size={16} className="mt-1 animate-spin text-ink-light" />}
        {date !== today && !busy && (
          <button
            type="button"
            onClick={() => setDate(today)}
            className="shrink-0 rounded-full border border-line bg-warm-white px-3 py-1.5 text-[12px] font-bold text-ink-muted"
          >
            Today
          </button>
        )}
      </div>

      {!loaded ? (
        <div className="space-y-2">
          <Skeleton className="h-[42px] rounded-[12px]" />
          <Skeleton className="h-[42px] rounded-[12px]" />
        </div>
      ) : error ? (
        <div className="py-6 text-center text-sm text-ink-muted">
          <p className="mb-3">Couldn&apos;t load this day.</p>
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
          <div className="grid grid-cols-2 gap-2">
            {ATTENDANCE_STATUSES.map((s) => {
              const on = record?.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!canEdit || busy}
                  aria-pressed={on}
                  onClick={() => mark(s, record?.note ?? "")}
                  className={`rounded-[12px] border px-2 py-3 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    on ? TONE[s] : "border-line bg-cream text-ink-muted"
                  }`}
                >
                  {STATUS_META[s].label}
                </button>
              );
            })}
          </div>

          {record && canEdit && (
            <div className="mt-2.5 flex items-center gap-2">
              <input
                type="text"
                value={noteDraft ?? record.note}
                disabled={busy}
                maxLength={200}
                placeholder={
                  record.status === "leave"
                    ? "Why? e.g. sick, family function (optional)"
                    : "Add a note (optional)"
                }
                aria-label="Note"
                onChange={(ev) => setNoteDraft(ev.target.value)}
                onBlur={() => void saveNote()}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") ev.currentTarget.blur();
                }}
                className="min-w-0 flex-1 rounded-[10px] border border-line bg-cream px-2.5 py-2 text-[12.5px] outline-none focus:border-brown disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void clear()}
                disabled={busy}
                aria-label="Clear this day"
                title="Clear this day"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-warm-white text-ink-light disabled:opacity-60"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {record && !canEdit && record.note && (
            <div className="mt-2.5 rounded-[10px] bg-cream px-2.5 py-2 text-[12.5px] text-ink-muted">
              {record.note}
            </div>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-light">
            {canEdit
              ? "Leave is unpaid, so it deducts a day. Present, Holiday and unmarked days all deduct nothing — notes are saved when you tap away."
              : "You have view-only access to attendance."}
          </p>
        </>
      )}
    </div>
  );
}
