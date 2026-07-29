"use client";

import { useEffect, useState } from "react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { fetchSupplierSummary } from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Supplier, SupplierSummary } from "@/lib/types";

const Row = ({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) => (
  <div className="flex justify-between gap-4 border-t border-line-soft py-2.5 first:border-t-0">
    <span className="text-[12.5px] font-semibold text-ink-light">{label}</span>
    <span className={`text-right text-[13.5px] ${strong ? "font-extrabold text-ink" : "font-semibold text-ink"}`}>
      {value}
    </span>
  </div>
);

export function SupplierSummaryTab({ supplier }: { supplier: Supplier }) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const [summary, setSummary] = useState<SupplierSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    fetchSupplierSummary(supplier.id)
      .then((s) => alive && (setSummary(s), setLoaded(true)))
      .catch(() => alive && (setLoaded(true), toast("Couldn't load the summary", "error")));
    return () => {
      alive = false;
    };
  }, [supplier.id, toast]);

  if (!loaded) return <Skeleton className="h-56 w-full rounded-[18px]" />;
  if (!summary) {
    return (
      <p className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-sm text-ink-muted">
        No account activity yet.
      </p>
    );
  }

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;
  const inHouse = summary.supplierType === "in_house";

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[18px]">
      {inHouse ? (
        // In-house is reported on its own line and appears in no payable.
        <>
          <Row label="In-house production value" value={money(summary.inHouseValue)} strong />
          <Row label="Receipts" value={String(summary.purchaseOrderCount)} />
          <Row label="Last receipt" value={summary.lastTransactionDate ?? "—"} />
          <p className="mt-3 rounded-xl bg-cream px-3.5 py-2.5 text-[12.5px] font-semibold text-ink-muted">
            In-house production carries cost but is never a payable, so there is no
            outstanding balance, no GST and no payment history here.
          </p>
        </>
      ) : (
        <>
          <Row label="Total purchases" value={money(summary.totalPurchases)} />
          <Row label="Total payments" value={`−${money(summary.totalPayments)}`} />
          <Row label="Return credit" value={`−${money(summary.returnCredit)}`} />
          <Row label="Outstanding" value={money(summary.outstanding)} strong />
          <Row label="Purchase orders" value={String(summary.purchaseOrderCount)} />
          <Row label="Transactions" value={String(summary.transactionCount)} />
          <Row label="Last transaction" value={summary.lastTransactionDate ?? "—"} />
          <Row label="Last payment" value={summary.lastPaymentDate ?? "—"} />
          {summary.outstanding < 0 && (
            <p className="mt-3 rounded-xl bg-cream px-3.5 py-2.5 text-[12.5px] font-semibold text-ink-muted">
              A negative balance means this supplier has been paid or credited more
              than has been invoiced.
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-[11.5px] text-ink-muted">
        Every figure is computed from posted invoices, payments and returns — nothing
        here is stored, so it cannot fall out of step with the ledger.
      </p>
    </div>
  );
}
