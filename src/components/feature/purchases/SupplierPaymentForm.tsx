"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import {
  fetchPurchaseInvoices,
  fetchSupplierSummary,
  rpcRecordSupplierPayment,
} from "@/lib/supabase-data";
import { PURCHASE_MODES } from "@/lib/purchase";
import { isoDateLocal } from "@/lib/excel";
import type { PurchaseInvoice, PurchaseMode, Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";

export function SupplierPaymentForm({
  suppliers,
  onDone,
}: {
  suppliers: Supplier[];
  onDone: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  const [supplierId, setSupplierId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<PurchaseMode>("Cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // In-house suppliers are excluded entirely — there is nothing to pay, and the
  // database refuses such a row outright.
  const payable = useMemo(
    () => suppliers.filter((s) => s.supplierType === "external"),
    [suppliers],
  );

  useEffect(() => {
    if (!supplierId) {
      setInvoices([]);
      setOutstanding(null);
      return;
    }
    let alive = true;
    setInvoiceId("");
    Promise.all([
      fetchPurchaseInvoices({ supplierId }),
      fetchSupplierSummary(supplierId),
    ])
      .then(([inv, summary]) => {
        if (!alive) return;
        // Only a posted invoice can be paid.
        setInvoices(inv.filter((i) => i.status === "posted"));
        setOutstanding(summary?.outstanding ?? null);
      })
      .catch(() => alive && toast("Couldn't load this supplier's invoices", "error"));
    return () => {
      alive = false;
    };
  }, [supplierId, toast]);

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;
  const value = parseFloat(amount);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await rpcRecordSupplierPayment({
        supplierId,
        invoiceId: invoiceId || null,
        amount: value,
        paidOn,
        mode,
        referenceNo,
        notes,
      });
      toast(`Recorded ${money(value)} paid by ${mode}`, "success");
      setInvoiceId("");
      setAmount("");
      setReferenceNo("");
      setNotes("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record this payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[18px]">
      <div className="mb-3.5">
        <label className={labelCls} htmlFor="pp-supplier">Supplier</label>
        <select id="pp-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Choose supplier…</option>
          {payable.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
          ))}
        </select>
        {outstanding != null && (
          <p className="mt-1.5 text-[12.5px] font-semibold text-ink-muted">
            Outstanding: {money(outstanding)}
          </p>
        )}
      </div>

      <div className="mb-3.5">
        <label className={labelCls} htmlFor="pp-invoice">Against invoice (optional)</label>
        <select id="pp-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          <option value="">On account — no specific invoice</option>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.invoiceNo} · {i.purchaseDate} · {money(i.total)}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div>
          <label className={labelCls} htmlFor="pp-amount">Amount</label>
          <input
            id="pp-amount" type="number" min="0" step="0.01" placeholder="0.00"
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="pp-date">Paid on</label>
          <input
            id="pp-date" type="date" max={today}
            value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="pp-mode">Mode</label>
          <select
            id="pp-mode" value={mode}
            onChange={(e) => setMode(e.target.value as PurchaseMode)}
          >
            {PURCHASE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="pp-ref">Reference (optional)</label>
          <input
            id="pp-ref" type="text" placeholder="UTR, cheque no."
            value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="pp-notes">Notes (optional)</label>
          <input
            id="pp-notes" type="text"
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}

      <button
        type="button"
        className="btn-success flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={submit}
        disabled={busy || !supplierId || !(value > 0)}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {busy ? "Recording…" : "Record payment"}
      </button>
      <p className="mt-2 text-center text-[12px] text-ink-muted">
        A payment cannot be edited — a wrong one is deleted and re-entered, and both
        actions are logged.
      </p>
    </div>
  );
}
