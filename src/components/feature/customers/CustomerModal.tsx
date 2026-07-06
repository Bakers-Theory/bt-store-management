"use client";

import { useEffect, useState } from "react";
import { Loader2, Receipt as ReceiptIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import { useBakeryStore } from "@/lib/store";
import { fetchCustomerBills } from "@/lib/supabase-data";
import { formatDateFull } from "@/lib/format";
import type { Bill, Customer } from "@/lib/types";

export function CustomerModal({
  customer,
  onClose,
}: {
  customer: Customer;
  onClose: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewBill, setViewBill] = useState<Bill | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCustomerBills(customer.id)
      .then((rows) => {
        if (!alive) return;
        setBills(rows);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [customer.id]);

  return (
    <>
      <Modal title={customer.name || customer.phone} onClose={onClose}>
        <div className="mb-4 grid grid-cols-3 gap-2.5">
          <div className="rounded-[14px] border border-line bg-cream p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">Visits</div>
            <div className="num mt-1 text-lg font-extrabold text-ink">{customer.visitCount}</div>
          </div>
          <div className="rounded-[14px] border border-line bg-cream p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">Total spend</div>
            <div className="num mt-1 text-lg font-extrabold text-ink">
              {currency}
              {customer.totalSpend.toFixed(0)}
            </div>
          </div>
          <div className="rounded-[14px] border border-line bg-cream p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">Phone</div>
            <div className="num mt-1 text-sm font-extrabold text-ink">{customer.phone}</div>
          </div>
        </div>

        <div className="mb-2 text-[12px] font-bold tracking-[.04em] text-ink-muted">PURCHASES</div>

        {loading ? (
          <div className="flex justify-center py-8 text-ink-light">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : bills.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-muted">No purchases yet</div>
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-line">
            {bills.map((b) => {
              const cancelled = b.status === "cancelled";
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-3 border-t border-line-soft px-3.5 py-3 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-ink">
                      #{b.billNo}
                      {cancelled && <span className="badge badge-danger ml-1.5">Cancelled</span>}
                    </div>
                    <div className="text-[11.5px] text-ink-light">
                      {b.items.length} items · {formatDateFull(b.date)}
                    </div>
                  </div>
                  <div
                    className={`num shrink-0 text-right text-[14px] font-extrabold ${
                      cancelled ? "text-ink-muted line-through" : "text-ink"
                    }`}
                  >
                    {currency}
                    {b.total.toFixed(2)}
                  </div>
                  <button
                    className="btn-sm btn-secondary inline-flex shrink-0 items-center justify-center"
                    onClick={() => setViewBill(b)}
                    aria-label="View bill"
                  >
                    <ReceiptIcon size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {viewBill && <ViewBillModal bill={viewBill} onClose={() => setViewBill(null)} />}
    </>
  );
}
