"use client";

import Link from "next/link";
import {
  Banknote,
  Calculator,
  Landmark,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/Skeleton";
import { cashDifference, differenceLabel } from "@/lib/cashbook";
import type { CashbookSummary, CashDaySummary } from "@/lib/types";

const cardCls =
  "rounded-[18px] border border-line bg-warm-white px-4 py-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.05)]";
const labelCls =
  "min-w-0 text-[11px] font-bold uppercase leading-tight tracking-wide text-[#8a6a3c]";

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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cardCls}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <div>
          <p className={`${labelCls} mb-1.5`}>Today&apos;s drawer</p>
          {/* A day with no cash_day row reports status 'open' and countedCash
              null — that is "not counted yet", not zero. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Expected in drawer today"
              value={money(daySummary.expectedCash)}
              icon={<Calculator size={13} />}
            />
            <Tile
              label="Counted today"
              value={
                daySummary.countedCash === null
                  ? "Not counted"
                  : money(daySummary.countedCash)
              }
              icon={<Wallet size={13} />}
            />
            <Tile
              label="Difference today"
              value={
                daySummary.countedCash === null
                  ? "—"
                  : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${money(Math.abs(diff))}`
              }
              icon={<Scale size={13} />}
              tone={diff < 0 ? "out" : diff > 0 ? "in" : undefined}
            />
            <Link
              href="/cashbook/day-close"
              className={`${cardCls} flex flex-col justify-center transition hover:border-brown`}
            >
              <span className={labelCls}>
                {daySummary.status === "closed" ? "Day closed" : "Day open"}
              </span>
              <span className="mt-1 text-sm font-bold text-ink">
                {daySummary.status === "closed" ? diffLabel.label : "Count & close →"}
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
