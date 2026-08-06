"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Receipt as ReceiptIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { fetchCustomerBills, rpcUpdateCustomer } from "@/lib/supabase-data";
import { formatDateFull, relativeDay } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { isValidGstin, stateCodeFromGstin } from "@/lib/gst";
import type { Bill, Customer, InvoiceType } from "@/lib/types";

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
  const user = useCurrentUser();
  const canEdit = hasPermission(user, "customers.edit");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [gstin, setGstin] = useState(customer.gstin);
  const [stateCode, setStateCode] = useState(customer.stateCode);
  const [billingAddress, setBillingAddress] = useState(customer.billingAddress);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(customer.defaultInvoiceType);
  const [saving, setSaving] = useState(false);

  // Shown as the state-code placeholder: leaving the field blank adopts this.
  const derivedStateCode = stateCodeFromGstin(gstin.trim().toUpperCase());

  const startEdit = () => {
    setName(customer.name);
    setPhone(customer.phone);
    setGstin(customer.gstin);
    setStateCode(customer.stateCode);
    setBillingAddress(customer.billingAddress);
    setInvoiceType(customer.defaultInvoiceType);
    setEditing(true);
  };

  const save = async () => {
    if (!/^\d{10}$/.test(phone)) {
      toast("Phone number must be exactly 10 digits", "error");
      return;
    }
    const gst = gstin.trim().toUpperCase();
    if (gst !== "" && !isValidGstin(gst)) {
      toast("That GSTIN does not look right", "error");
      return;
    }
    // A blank state code follows the GSTIN, so the two cannot silently disagree
    // about where the customer is. The server applies the same fallback.
    const state = stateCode.trim() || stateCodeFromGstin(gst);
    const trimmedName = name.trim();
    const patch = {
      name: trimmedName,
      phone,
      gstin: gst,
      stateCode: state,
      billingAddress: billingAddress.trim(),
      defaultInvoiceType: invoiceType,
    };
    setSaving(true);
    try {
      await rpcUpdateCustomer(customer.id, patch);
      onUpdated?.({ ...customer, ...patch });
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

            <label className="mb-1 mt-3 block text-[11px] font-bold text-ink-muted">GSTIN</label>
            <input
              type="text"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase().slice(0, 15))}
              placeholder="Blank if unregistered"
              className="w-full uppercase"
            />

            <label className="mb-1 mt-3 block text-[11px] font-bold text-ink-muted">
              State code
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder={derivedStateCode || "e.g. 29"}
              className="w-full"
            />

            <label className="mb-1 mt-3 block text-[11px] font-bold text-ink-muted">
              Billing address
            </label>
            <textarea
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              rows={2}
              placeholder="Printed on the tax invoice"
              className="w-full"
            />

            <span className="mb-1 mt-3 block text-[11px] font-bold text-ink-muted">
              Default invoice type
            </span>
            <div className="inline-flex overflow-hidden rounded-[11px] border border-line">
              {(
                [
                  ["non_gst", "Non-GST"],
                  ["gst", "GST"],
                ] as const
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setInvoiceType(type)}
                  aria-pressed={invoiceType === type}
                  className={`px-3.5 py-2 text-xs font-bold ${
                    invoiceType === type
                      ? "bg-brown text-warm-white"
                      : "bg-warm-white text-ink-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              Pre-fills the toggle at the counter; the biller can still change it
              on the bill.
            </p>

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
        ) : canEdit ? (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-warm-white px-3 py-1.5 text-[12.5px] font-bold text-ink-muted"
            >
              <Pencil size={13} /> Edit details
            </button>
          </div>
        ) : null}
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
