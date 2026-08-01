"use client";

import Link from "next/link";
import { ArrowRight, ArrowDownCircle, ArrowUpCircle, ScrollText, Truck } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { SupplierTotals } from "@/lib/purchase";

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

export function SupplierBalanceCard({
  loading,
  error,
  totals,
  currency,
}: {
  loading: boolean;
  error?: boolean;
  totals: SupplierTotals | null;
  currency: string;
}) {
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="flex items-center gap-1.5">
          <Truck size={16} /> Suppliers &amp; Purchases
        </h3>
        <Link href="/purchases" className="flex items-center gap-1 text-[12px] font-bold text-brown">
          View <ArrowRight size={12} />
        </Link>
      </div>
      {error ? (
        <div className="p-3 text-center text-[12.5px] text-danger">Couldn&apos;t load supplier balances</div>
      ) : loading || !totals ? (
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
          <Tile
            label="Outstanding"
            value={money(totals.outstanding)}
            icon={<ArrowUpCircle size={13} />}
            tone="out"
          />
          <Tile label="Suppliers owing" value={String(totals.suppliersOwing)} icon={<Truck size={13} />} />
          <Tile
            label="Total purchases"
            value={money(totals.purchases)}
            icon={<ScrollText size={13} />}
          />
          <Tile
            label="Total payments"
            value={money(totals.payments)}
            icon={<ArrowDownCircle size={13} />}
            tone="in"
          />
        </div>
      )}
    </div>
  );
}
