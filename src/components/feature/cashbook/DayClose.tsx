"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { fetchCashDaysPage, fetchCashDaySummary } from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import { Skeleton } from "@/components/ui/Skeleton";
import { DayCloseCard } from "./DayCloseCard";
import { DayHistory } from "./DayHistory";
import type { CashDay, CashDaySummary } from "@/lib/types";

const PAGE = 30;

export function DayClose() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  const canClose = hasPermission(user, "cashbook.close");
  const canReopen = hasPermission(user, "cashbook.reopen");

  const today = isoDateLocal(new Date());
  const [summary, setSummary] = useState<CashDaySummary | null>(null);
  const [days, setDays] = useState<CashDay[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      fetchCashDaySummary(today),
      fetchCashDaysPage(0, PAGE),
    ])
      .then(([s, page]) => {
        setSummary(s);
        setDays(page.days);
        setHasMore(page.hasMore);
      })
      .catch(() => toast("Couldn't load the day's figures", "error"))
      .finally(() => setLoaded(true));
  }, [today, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const more = () => {
    fetchCashDaysPage(days.length, PAGE)
      .then((page) => {
        setDays((prev) => [...prev, ...page.days]);
        setHasMore(page.hasMore);
      })
      .catch(() => toast("Couldn't load more days", "error"));
  };

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/cashbook"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8a6a3c]"
        >
          <ArrowLeft size={13} /> Cashbook
        </Link>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">Day close</h1>
        <p className="text-xs text-ink-muted">
          Count the drawer, record the difference, lock the day
        </p>
      </div>

      {!loaded || !summary ? (
        <>
          <Skeleton className="h-64 w-full rounded-[18px]" />
          <Skeleton className="h-40 w-full rounded-[18px]" />
        </>
      ) : (
        <>
          <DayCloseCard
            onDate={today}
            summary={summary}
            canClose={canClose}
            onClosed={() => void load()}
          />

          <div>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#8a6a3c]">
              Opening &amp; closing balances
            </h2>
            <DayHistory days={days} canReopen={canReopen} onChanged={() => void load()} />
            {hasMore && (
              <button
                onClick={more}
                className="mt-2 w-full rounded-[13px] border border-line bg-warm-white py-2.5 text-xs font-bold text-ink"
              >
                Load more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
