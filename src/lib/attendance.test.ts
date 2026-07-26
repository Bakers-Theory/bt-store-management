import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_STATUSES,
  STATUS_META,
  attendanceCsv,
  isAttendanceStatus,
  payableDays,
  summaryCsv,
  tally,
  totalsOf,
  toCsv,
  unmarkedCount,
} from "./attendance";
import type { Attendance, AttendanceStatus, AttendanceSummary } from "./types";

const rec = (
  profileId: string,
  date: string,
  status: AttendanceStatus,
  extra: Partial<Attendance> = {},
): Attendance => ({
  id: `${profileId}-${date}`,
  profileId,
  employeeName: profileId,
  date,
  status,
  note: "",
  markedByName: "Admin",
  updatedAt: "2026-07-26T00:00:00.000Z",
  ...extra,
});

const counts = (p: Partial<Record<AttendanceStatus, number>>) => ({
  present: 0, half_day: 0, leave: 0, holiday: 0, ...p,
});

describe("status catalogue", () => {
  it("covers the four recordable statuses with metadata", () => {
    expect(ATTENDANCE_STATUSES).toHaveLength(4);
    for (const s of ATTENDANCE_STATUSES) {
      expect(STATUS_META[s].label.length, s).toBeGreaterThan(0);
      expect(STATUS_META[s].short.length, s).toBeGreaterThan(0);
    }
  });
  it("has no 'absent' status — an unmarked day is the absence", () => {
    expect(isAttendanceStatus("absent")).toBe(false);
    expect(ATTENDANCE_STATUSES).not.toContain("absent");
  });
  it("validates untrusted status input", () => {
    expect(isAttendanceStatus("half_day")).toBe(true);
    expect(isAttendanceStatus("Present")).toBe(false); // case matters
    expect(isAttendanceStatus("vacation")).toBe(false);
    expect(isAttendanceStatus(null)).toBe(false);
    // Must not be fooled by inherited Object properties.
    expect(isAttendanceStatus("toString")).toBe(false);
  });
});

describe("payableDays", () => {
  it("pays Present, Leave and Holiday in full", () => {
    expect(payableDays(counts({ present: 3 }))).toBe(3);
    expect(payableDays(counts({ leave: 2 }))).toBe(2);
    expect(payableDays(counts({ holiday: 4 }))).toBe(4);
  });
  it("pays a half day at one half", () => {
    expect(payableDays(counts({ half_day: 1 }))).toBe(0.5);
    expect(payableDays(counts({ half_day: 3 }))).toBe(1.5);
  });
  it("matches the worked example: 22 present, 2 half, 2 days unrecorded", () => {
    // The 2 absences are expressed by having no record, so they simply never
    // enter the tally — 22 + (2 × 0.5) = 23 payable days out of 26.
    expect(payableDays(counts({ present: 22, half_day: 2 }))).toBe(23);
  });
  it("is zero for a month with nothing recorded — a full month absent", () => {
    expect(payableDays(counts({}))).toBe(0);
  });
  it("keeps an odd number of half days exact, not floating-point noise", () => {
    // 7 × 0.5 = 3.5 — naive summing of 0.5s is safe, but the rounding contract
    // must hold for payroll to reconcile against the SQL figure.
    expect(payableDays(counts({ half_day: 7 }))).toBe(3.5);
    expect(payableDays(counts({ present: 1, half_day: 1 }))).toBe(1.5);
  });
});

describe("tally", () => {
  it("counts by status and reports zeros for the rest", () => {
    const t = tally([
      rec("a", "2026-07-01", "present"),
      rec("a", "2026-07-02", "present"),
      rec("a", "2026-07-03", "leave"),
      rec("a", "2026-07-04", "half_day"),
    ]);
    expect(t).toEqual(counts({ present: 2, leave: 1, half_day: 1 }));
  });
  it("returns all zeros for no records", () => {
    expect(tally([])).toEqual(counts({}));
  });
});

const summary = (
  name: string,
  p: Partial<AttendanceSummary> = {},
): AttendanceSummary => ({
  profileId: name, employeeName: name,
  present: 0, halfDay: 0, leave: 0, holiday: 0,
  recorded: 0, payableDays: 0, ...p,
});

describe("totalsOf", () => {
  it("adds up every employee's tallies", () => {
    const t = totalsOf([
      summary("A", { present: 20, leave: 2, recorded: 22, payableDays: 22 }),
      summary("B", { present: 18, halfDay: 2, recorded: 20, payableDays: 19 }),
    ]);
    expect(t.present).toBe(38);
    expect(t.leave).toBe(2);
    expect(t.halfDay).toBe(2);
    expect(t.recorded).toBe(42);
    expect(t.payableDays).toBe(41);
  });
  it("keeps fractional day totals exact across employees", () => {
    const t = totalsOf([
      summary("A", { payableDays: 0.5 }),
      summary("B", { payableDays: 0.5 }),
      summary("C", { payableDays: 0.5 }),
    ]);
    expect(t.payableDays).toBe(1.5);
  });
  it("is all zeros for an empty roster", () => {
    expect(totalsOf([]).recorded).toBe(0);
  });
});

describe("unmarkedCount", () => {
  it("counts employees with no record for the day — i.e. the absentees", () => {
    const day = [rec("a", "2026-07-01", "present"), rec("b", "2026-07-01", "leave")];
    expect(unmarkedCount(["a", "b", "c", "d"], day)).toBe(2);
  });
  it("is zero once everyone is marked", () => {
    expect(unmarkedCount(["a"], [rec("a", "2026-07-01", "leave")])).toBe(0);
  });
  it("ignores records for employees no longer on the roster", () => {
    expect(unmarkedCount(["a"], [rec("z", "2026-07-01", "present")])).toBe(1);
  });
});

describe("CSV escaping", () => {
  it("quotes commas, quotes and newlines, and doubles inner quotes", () => {
    expect(toCsv([["plain", "a,b"]])).toBe('plain,"a,b"');
    expect(toCsv([['say "hi"']])).toBe('"say ""hi"""');
    expect(toCsv([["line1\nline2"]])).toBe('"line1\nline2"');
  });
  it("separates rows with CRLF", () => {
    expect(toCsv([["a"], ["b"]])).toBe("a\r\nb");
  });
  it("cannot be broken by a note containing a comma", () => {
    const csv = attendanceCsv([
      rec("a", "2026-07-01", "leave", { employeeName: "Anjali", note: "sick, called in" }),
    ]);
    expect(csv).toContain('"sick, called in"');
    // Header + one row, and the embedded comma must not add a line.
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("CSV exports", () => {
  it("writes a detail row per record with readable status labels", () => {
    const csv = attendanceCsv([
      rec("a", "2026-07-01", "half_day", { employeeName: "Anjali" }),
    ]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("Date,Employee,Status,Note,Marked by");
    expect(row).toBe("2026-07-01,Anjali,Half Day,,Admin");
  });
  it("writes a summary row per employee", () => {
    const csv = summaryCsv([
      summary("Anjali", { present: 20, halfDay: 2, recorded: 22, payableDays: 21 }),
    ]);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Payable days");
    expect(header).not.toContain("Absent");
    expect(row).toBe("Anjali,20,2,0,0,22,21");
  });
  it("emits a header even with no data, so the file is never empty", () => {
    expect(attendanceCsv([]).split("\r\n")).toHaveLength(1);
    expect(summaryCsv([])).toContain("Employee");
  });
});
