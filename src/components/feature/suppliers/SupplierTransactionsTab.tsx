"use client";

import { useEffect, useMemo, useState } from "react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import {
  fetchPurchaseInvoices,
  fetchPurchaseReturns,
  fetchSupplierPayments,
} from "@/lib/supabase-data";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DateRange } from "@/lib/date-range";
import type { Supplier } from "@/lib/types";

type Kind = "Purchase" | "Payment" | "Return";

interface Entry {
  id: string;
  kind: Kind;
  date: string;
  reference: string;
  detail: string;
  amount: number;
  status: string;
}

export function SupplierTransactionsTab({ supplier }: { supplier: Supplier }) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const canFinancial = hasPermission(user, "suppliers.financial");

  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    const opts = { supplierId: supplier.id, range };
    Promise.all([
      fetchPurchaseInvoices(opts),
      // An in-house supplier has no payments and no returns by construction, so
      // the two queries are skipped rather than run and thrown away.
      supplier.supplierType === "external" ? fetchSupplierPayments(opts) : Promise.resolve([]),
      supplier.supplierType === "external" ? fetchPurchaseReturns(opts) : Promise.resolve([]),
    ])
      .then(([invoices, payments, returns]) => {
        if (!alive) return;
        const rows: Entry[] = [
          ...invoices.map((i) => ({
            id: `i-${i.id}`,
            kind: "Purchase" as Kind,
            date: i.purchaseDate,
            reference: i.invoiceNo ?? i.internalRef ?? "—",
            detail: i.notes,
            amount: i.total,
            status: i.status,
          })),
          ...payments.map((p) => ({
            id: `p-${p.id}`,
            kind: "Payment" as Kind,
            date: p.paidOn,
            reference: p.referenceNo || p.invoiceNo || "On account",
            detail: p.mode,
            amount: p.amount,
            status: "posted",
          })),
          ...returns.map((r) => ({
            id: `r-${r.id}`,
            kind: "Return" as Kind,
            date: r.returnDate,
            reference: r.invoiceNo ?? "—",
            detail: r.reason,
            amount: r.total,
            status: r.status,
          })),
        ];
        // ISO dates sort lexically, so no Date construction is needed.
        rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        setEntries(rows);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setLoaded(true);
        toast("Couldn't load transactions", "error");
      });
    return () => {
      alive = false;
    };
  }, [supplier.id, supplier.supplierType, range, toast]);

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;
  const counts = useMemo(() => {
    const by = (k: Kind) => entries.filter((e) => e.kind === k).length;
    return { purchases: by("Purchase"), payments: by("Payment"), returns: by("Return") };
  }, [entries]);

  return (
    <>
      <div className="mb-3.5">
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {!loaded ? (
        <Skeleton className="h-40 w-full rounded-[18px]" />
      ) : entries.length === 0 ? (
        <p className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-sm text-ink-muted">
          No transactions in this period.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[12px] font-semibold text-ink-muted">
            {counts.purchases} purchase(s) · {counts.payments} payment(s) · {counts.returns} return(s)
          </p>
          <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-ink">
                    {e.kind} · {e.reference}
                  </div>
                  <div className="truncate text-[12px] font-semibold text-ink-light">
                    {e.date}
                    {e.detail ? ` · ${e.detail}` : ""}
                    {e.status !== "posted" ? ` · ${e.status}` : ""}
                  </div>
                </div>
                {canFinancial && (
                  <div className="shrink-0 text-[13.5px] font-bold text-ink">
                    {/* A payment and a return both reduce what is owed, so both
                        read as negative against a purchase. */}
                    {e.kind === "Purchase" ? money(e.amount) : `−${money(e.amount)}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
