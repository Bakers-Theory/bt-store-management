"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Receipt as ReceiptIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { fetchCustomerBills, rpcUpdateCustomer } from "@/lib/supabase-data";
import { formatDateFull, relativeDay } from "@/lib/format";
import type { Bill, Customer } from "@/lib/types";

export function CustomerModal({
  customer,
  onClose,
  onUpdated,
}: {
  customer: Customer;
  onClose: () => void;
  onUpdated?: (customer: Customer) => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [viewBill, setViewBill] = useState<Bill | null>(null);

  // Inline edit of name/phone — the directory was otherwise read-only, so a
  // typo made at billing time was permanent.
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setName(customer.name);
    setPhone(customer.phone);
    setEditing(true);
  };

  const save = async () => {
    if (!/^\d{10}$/.test(phone)) {
      toast("Phone number must be exactly 10 digits", "error");
      return;
    }
    const trimmedName = name.trim();
    setSaving(true);
    try {
      await rpcUpdateCustomer(customer.id, trimmedName, phone);
      onUpdated?.({ ...customer, name: trimmedName, phone });
      toast("Customer updated", "success");
      setEditing(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update customer", "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    fetchCustomerBills(customer.id)
      .then((rows) => {
        if (!alive) return;
        setBills(rows);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [customer.id, retryToken]);

  return (
    <>
      <Modal title={customer.name || customer.phone} onClose={onClose}>
        {editing ? (
          <div className="mb-4 rounded-[14px] border border-line bg-cream p-3.5">
            <label className="mb-1 block text-[11px] font-bold text-ink-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
              className="mb-3 w-full"
            />
            <label className="mb-1 block text-[11px] font-bold text-ink-muted">Phone</label>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit phone"
              className="w-full"
            />
            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border-none bg-brown p-2.5 text-[13px] font-bold text-warm-white disabled:opacity-60"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-xl border border-line bg-warm-white px-4 py-2.5 text-[13px] font-bold text-ink-muted disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-warm-white px-3 py-1.5 text-[12.5px] font-bold text-ink-muted"
            >
              <Pencil size={13} /> Edit details
            </button>
          </div>
        )}
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-[14px] border border-line bg-cream p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">Visits</div>
            <div className="num mt-1 text-lg font-extrabold text-ink">{customer.visitCount}</div>
          </div>
          <div className="rounded-[14px] border border-line bg-cream p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">Total spend</div>
            <div className="num mt-1 text-lg font-extrabold text-ink">
              {currency}
              {customer.totalSpend.toFixed(2)}
            </div>
          </div>
          <div className="rounded-[14px] border border-line bg-cream p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">Last visit</div>
            <div className="num mt-1 text-sm font-extrabold text-ink">
              {customer.lastPurchase ? relativeDay(customer.lastPurchase) : "—"}
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
        ) : error ? (
          <div className="py-8 text-center text-sm">
            <p className="mb-3 text-ink-muted">Couldn&apos;t load purchases.</p>
            <button
              type="button"
              onClick={() => setRetryToken((t) => t + 1)}
              className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
            >
              Retry
            </button>
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
