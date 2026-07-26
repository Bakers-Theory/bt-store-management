"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { fetchEmployees } from "@/lib/supabase-data";
import { tabCls } from "@/components/ui/tabClass";
import { Skeleton } from "@/components/ui/Skeleton";
import { NoAccess } from "@/components/feature/NoAccess";
import { AttendanceDay } from "./AttendanceDay";
import { AttendanceHistory } from "./AttendanceHistory";
import { AttendanceMonth } from "./AttendanceMonth";
import type { Employee } from "@/lib/types";

export function Attendance() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<"day" | "month" | "history">("day");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

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
      <div className="mb-4 flex w-fit gap-1.5 rounded-xl bg-[#f4e7d2] p-1">
        <button className={tabCls(tab === "day")} onClick={() => setTab("day")}>
          Mark day
        </button>
        <button className={tabCls(tab === "month")} onClick={() => setTab("month")}>
          Month
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
        <AttendanceDay employees={employees} canEdit={canEdit} />
      ) : tab === "month" ? (
        <AttendanceMonth employees={employees} />
      ) : (
        <AttendanceHistory employees={employees} />
      )}
    </>
  );
}
