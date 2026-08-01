"use client";

import Link from "next/link";
import { ArrowRight, CalendarX, Clock, HelpCircle, UserCheck, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";

export interface AttendanceCounts {
  present: number;
  halfDay: number;
  leaveOrHoliday: number;
  unmarked: number;
}

function Tile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-line-soft bg-cream px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[#8a6a3c]">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="num mt-1 text-[15.5px] font-bold text-ink">{value}</p>
    </div>
  );
}

export function AttendanceCard({
  loading,
  error,
  counts,
}: {
  loading: boolean;
  error?: boolean;
  counts: AttendanceCounts | null;
}) {
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="flex items-center gap-1.5">
          <Users size={16} /> Attendance
        </h3>
        <Link href="/attendance" className="flex items-center gap-1 text-[12px] font-bold text-brown">
          View <ArrowRight size={12} />
        </Link>
      </div>
      {error ? (
        <div className="p-3 text-center text-[12.5px] text-danger">
          Couldn&apos;t load today&apos;s attendance
        </div>
      ) : loading || !counts ? (
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-[14px] border border-line-soft bg-cream px-3 py-2.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-4 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="Present" value={String(counts.present)} icon={<UserCheck size={13} />} />
          <Tile label="Half day" value={String(counts.halfDay)} icon={<Clock size={13} />} />
          <Tile label="Leave / Holiday" value={String(counts.leaveOrHoliday)} icon={<CalendarX size={13} />} />
          <Tile label="Unmarked" value={String(counts.unmarked)} icon={<HelpCircle size={13} />} />
        </div>
      )}
    </div>
  );
}