"use client";

import Link from "next/link";
import { ArrowRight, Banknote, Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CashbookSummary } from "@/lib/types";

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
    <div className="rounded-[14px] border border-line-soft bg-cream px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[#8a6a3c]">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`num mt-1 text-[15.5px] font-bold ${
          tone === "in" ? "text-success" : tone === "out" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function CashbookSummaryCard({
  loading,
  error,
  summary,
  currency,
  periodLabel,
}: {
  loading: boolean;
  error?: boolean;
  summary: CashbookSummary | null;
  currency: string;
  /** From `periodLabel(range, today)` — "Today", "1 Jul – 31 Jul", "All time" … */
  periodLabel: string;
}) {
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="flex items-center gap-1.5">
          <Wallet size={16} /> Cashbook
        </h3>
        <Link href="/cashbook" className="flex items-center gap-1 text-[12px] font-bold text-brown">
          View <ArrowRight size={12} />
        </Link>
      </div>
      {error ? (
        <div className="p-3 text-center text-[12.5px] text-danger">Couldn&apos;t load cashbook balances</div>
      ) : loading || !summary ? (
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
          <Tile label="Cash in hand" value={money(summary.cashBalance)} icon={<Banknote size={13} />} />
          <Tile label="Bank balance" value={money(summary.bankBalance)} icon={<Landmark size={13} />} />
          <Tile
            label={`Sales · ${periodLabel}`}
            value={money(summary.periodSales)}
            icon={<TrendingUp size={13} />}
            tone="in"
          />
          <Tile
            label={`Expenses · ${periodLabel}`}
            value={money(summary.periodExpenses)}
            icon={<TrendingDown size={13} />}
            tone="out"
          />
        </div>
      )}
    </div>
  );
}
