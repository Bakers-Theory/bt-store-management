"use client";

import Link from "next/link";
import { ArrowRight, Banknote, Landmark, Lock, TrendingDown, TrendingUp } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/Skeleton";
import { cashDifference, differenceLabel } from "@/lib/cashbook";
import type { CashbookSummary, CashDaySummary } from "@/lib/types";

const cardCls =
  "rounded-[18px] border border-line bg-warm-white px-4 py-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.05)]";
const labelCls =
  "min-w-0 text-[11px] font-bold uppercase leading-tight tracking-wide text-[#8a6a3c]";

const toneCls = {
  in: "text-green-700",
  out: "text-red-700",
  none: "text-ink",
} as const;

// A date-only string must never go through `new Date()` — that parses as UTC
// midnight and renders the previous day in a negative-offset timezone.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const shortDay = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
};

/** One label/value line inside a column of the Today card. */
function Figure({
  label,
  value,
  strong,
  tone = "none",
}: {
  label: string;
  value: string;
  /** The line the eye should land on first — the expected figure. */
  strong?: boolean;
  tone?: "in" | "out" | "none";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <span
        className={`shrink-0 font-bold tabular-nums ${strong ? "text-lg" : "text-sm"} ${
          toneCls[tone]
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Tile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "in" | "out";
}) {
  return (
    <div className={cardCls}>
      {/* The label carries the period, so it can run long — let it wrap rather
          than clip a date range out of view. */}
      <div className="flex items-start gap-1.5">
        <span className="mt-px shrink-0 text-[#8a6a3c]">{icon}</span>
        <span className={labelCls}>{label}</span>
      </div>
      <p
        className={`mt-1.5 text-xl font-bold tabular-nums ${
          tone === "in" ? "text-green-700" : tone === "out" ? "text-red-700" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function CashbookTiles({
  summary,
  daySummary,
  periodLabel,
}: {
  summary: CashbookSummary | null;
  /** Today's reconciliation figures — independent of the range filter above. */
  daySummary: CashDaySummary | null;
  /** From `periodLabel(filters.range, today)` — "Today", "1 Jul – 31 Jul", … */
  periodLabel: string;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  // "Today's sales" reads better than "Today sales"; every other period reads
  // better with the period after the noun.
  const periodic = (noun: string) =>
    periodLabel === "Today" ? `Today's ${noun}` : `${noun} · ${periodLabel}`;

  // Recomputed rather than read: the server rounds the same way, and this keeps
  // the tile honest if the payload ever lags a posting.
  const diff =
    daySummary && daySummary.countedCash !== null
      ? cashDifference(daySummary.countedCash, daySummary.expectedCash)
      : 0;
  const diffLabel = differenceLabel(diff);

  // Null closingBank means the bank was never checked, which is not zero.
  const bankDiff =
    daySummary && daySummary.closingBank !== null
      ? cashDifference(daySummary.closingBank, daySummary.expectedBank)
      : 0;

  return (
    <div className="space-y-3">
      {!summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cardCls}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Cash in hand"
            value={money(summary.cashBalance)}
            icon={<Banknote size={13} />}
          />
          <Tile
            label="Bank balance"
            value={money(summary.bankBalance)}
            icon={<Landmark size={13} />}
          />
          <Tile
            label={periodic("sales")}
            value={money(summary.periodSales)}
            icon={<TrendingUp size={13} />}
            tone="in"
          />
          <Tile
            label={periodic("expenses")}
            value={money(summary.periodExpenses)}
            icon={<TrendingDown size={13} />}
            tone="out"
          />
        </div>
      )}

      {!daySummary ? (
        <div className="rounded-[18px] border border-line bg-warm-white p-5">
          <Skeleton className="h-3 w-24" />
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            {[0, 1].map((col) => (
              <div key={col} className="space-y-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-10 w-full" />
        </div>
      ) : (
        <div className="rounded-[18px] border border-line bg-warm-white p-5 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          <p className={`${labelCls} mb-3`}>
            Today · {shortDay(daySummary.onDate)}
          </p>

          <div className="grid gap-5 sm:grid-cols-2 sm:gap-0">
            {/* A day with no cash_day row reports status 'open' and countedCash
                null — that is "not counted yet", not zero. */}
            <div className="sm:pr-5">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8a6a3c]">
                <Banknote size={12} /> Cash
              </p>
              <Figure
                label="Expected in drawer"
                value={money(daySummary.expectedCash)}
                strong
              />
              <Figure
                label="Counted"
                value={
                  daySummary.countedCash === null
                    ? "Not counted"
                    : money(daySummary.countedCash)
                }
              />
              <Figure
                label="Difference"
                value={
                  daySummary.countedCash === null
                    ? "—"
                    : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${money(Math.abs(diff))}`
                }
                tone={diff < 0 ? "out" : diff > 0 ? "in" : "none"}
              />
            </div>

            {/* closingBank null means nobody read a balance off the bank. */}
            <div className="border-t border-line-soft pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8a6a3c]">
                <Landmark size={12} /> Bank
              </p>
              <Figure
                label="Per the book"
                value={money(daySummary.expectedBank)}
                strong
              />
              <Figure
                label="Closing balance"
                value={
                  daySummary.closingBank === null
                    ? "Not checked"
                    : money(daySummary.closingBank)
                }
              />
              <Figure
                label="Difference"
                value={
                  daySummary.closingBank === null
                    ? "—"
                    : `${bankDiff > 0 ? "+" : bankDiff < 0 ? "−" : ""}${money(
                        Math.abs(bankDiff),
                      )}`
                }
                tone={bankDiff < 0 ? "out" : bankDiff > 0 ? "in" : "none"}
              />
            </div>
          </div>

          {/* The page's only route to day close. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                {daySummary.status === "closed" && (
                  <Lock size={13} className="text-[#8a6a3c]" />
                )}
                {daySummary.status === "closed"
                  ? `Day closed · ${diffLabel.label}`
                  : "Day open"}
              </p>
              <p className="text-[11px] text-ink-muted">
                {daySummary.status === "closed"
                  ? "Nothing can post to today until an admin reopens it"
                  : "Count the drawer and read the bank to lock the day"}
              </p>
            </div>
            <Link
              href="/cashbook/day-close"
              className={
                daySummary.status === "closed"
                  ? "inline-flex items-center gap-1.5 rounded-[13px] border border-line bg-warm-white px-3.5 py-2.5 text-xs font-bold text-ink transition hover:border-brown"
                  : "inline-flex items-center gap-1.5 rounded-[13px] bg-brown px-3.5 py-2.5 text-xs font-bold text-white"
              }
            >
              {daySummary.status === "closed" ? "View day close" : "Count & close"}
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
