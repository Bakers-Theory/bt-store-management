"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { fetchEmployees } from "@/lib/supabase-data";
import { tabCls } from "@/components/ui/tabClass";
import { Skeleton } from "@/components/ui/Skeleton";
import { NoAccess } from "@/components/feature/NoAccess";
import { AttendanceDay, localDay } from "./AttendanceDay";
import { AttendanceHistory } from "./AttendanceHistory";
import { AttendanceMonth } from "./AttendanceMonth";
import { EmployeePicker } from "./EmployeePicker";
import type { Employee } from "@/lib/types";

export function Attendance() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<"day" | "history">("day");
  // The calendar and the roster below it are two views of one selected date.
  const [day, setDay] = useState(localDay());
  // Bumped on every save so the calendar above re-reads the month it's showing.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  // Who the calendar and the marking card below it are both about. Resolved
  // rather than synced with an effect, so a roster that loads or changes
  // underneath us can never leave a stale id selected.
  const [empId, setEmpId] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const employee = employees.find((e) => e.id === empId) ?? employees[0];

  // The roster is shared by all three tabs, so it's fetched once here.
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchEmployees()
      .then((rows) => {
        if (!alive) return;
        setEmployees(rows);
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
  }, [retry]);

  // Defence in depth on top of RLS, which is the real gate.
  if (user && !hasPermission(user, "attendance.view")) return <NoAccess />;
  const canEdit = hasPermission(user, "attendance.edit");

  return (
    <>
      <div className="mb-4 flex w-fit max-w-full gap-1.5 overflow-x-auto rounded-xl bg-[#f4e7d2] p-1">
        <button className={tabCls(tab === "day")} onClick={() => setTab("day")}>
          Mark day
        </button>
        <button className={tabCls(tab === "history")} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[14px]" />
          ))}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          <p className="mb-3">Couldn&apos;t load the staff list.</p>
          <button
            type="button"
            onClick={() => setRetry((t) => t + 1)}
            className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
          >
            Retry
          </button>
        </div>
      ) : tab === "day" ? (
        <>
          <EmployeePicker
            employees={employees}
            value={employee?.id ?? ""}
            onChange={setEmpId}
          />
          {/* Calendar and marking panel sit side by side once there's room —
              stacked, the calendar would push the buttons off a phone screen. */}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
            <AttendanceMonth
              employeeId={employee?.id ?? ""}
              selected={day}
              onSelect={setDay}
              version={version}
            />
            <AttendanceDay
              employee={employee}
              canEdit={canEdit}
              date={day}
              setDate={setDay}
              onChanged={bump}
            />
          </div>
        </>
      ) : (
        <AttendanceHistory employees={employees} />
      )}
    </>
  );
}
