"use client";

import { useBakeryStore } from "@/lib/store";
import type { SupplierSummary } from "@/lib/types";

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

/**
 * One supplier's account position, laid out the same wherever it appears — the
 * supplier's own summary tab and the Balance tab on Purchases both render this,
 * so the two can never drift into describing the same numbers differently.
 *
 * Renders the rows only. The caller owns the surrounding card, because the two
 * callers frame it differently: one is a standalone panel, the other is an
 * expanded list row.
 */
export function SupplierAccountBreakdown({ summary }: { summary: SupplierSummary }) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  // In-house is reported on its own line and appears in no payable.
  if (summary.supplierType === "in_house") {
    return (
      <>
        <Row label="In-house production value" value={money(summary.inHouseValue)} strong />
        <Row label="Receipts" value={String(summary.purchaseOrderCount)} />
        <Row label="Last receipt" value={summary.lastTransactionDate ?? "—"} />
        <p className="mt-3 rounded-xl bg-cream px-3.5 py-2.5 text-[12.5px] font-semibold text-ink-muted">
          In-house production carries cost but is never a payable, so there is no
          outstanding balance, no GST and no payment history here.
        </p>
      </>
    );
  }

  return (
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
  );
}
