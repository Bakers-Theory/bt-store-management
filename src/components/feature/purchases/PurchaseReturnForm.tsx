"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import {
  fetchPurchaseInvoice,
  fetchPurchaseInvoices,
  rpcPostPurchaseReturn,
} from "@/lib/supabase-data";
import { isReturnQtyValid, lineTotal, returnableQty } from "@/lib/purchase";
import { isoDateLocal } from "@/lib/excel";
import type { PurchaseInvoice, Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";

export function PurchaseReturnForm({
  suppliers,
  onDone,
}: {
  suppliers: Supplier[];
  onDone: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const reloadStore = useBakeryStore((s) => s.load);
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  const [supplierId, setSupplierId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [returnDate, setReturnDate] = useState(today);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // A return is a credit note. There is nobody to credit for in-house
  // production — that stock leaves inventory through the write-off path.
  const returnable = useMemo(
    () => suppliers.filter((s) => s.supplierType === "external"),
    [suppliers],
  );

  useEffect(() => {
    if (!supplierId) {
      setInvoices([]);
      return;
    }
    let alive = true;
    setInvoiceId("");
    setInvoice(null);
    fetchPurchaseInvoices({ supplierId })
      .then((rows) => alive && setInvoices(rows.filter((i) => i.status === "posted")))
      .catch(() => alive && toast("Couldn't load invoices", "error"));
    return () => {
      alive = false;
    };
  }, [supplierId, toast]);

  useEffect(() => {
    if (!invoiceId) {
      setInvoice(null);
      setQtys({});
      return;
    }
    let alive = true;
    fetchPurchaseInvoice(invoiceId)
      .then((inv) => {
        if (!alive) return;
        setInvoice(inv);
        setQtys({});
      })
      .catch(() => alive && toast("Couldn't load that invoice", "error"));
    return () => {
      alive = false;
    };
  }, [invoiceId, toast]);

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  const entered = useMemo(
    () =>
      (invoice?.lines ?? [])
        .map((l) => ({ line: l, qty: parseFloat(qtys[l.id] ?? "") || 0 }))
        .filter((e) => e.qty > 0),
    [invoice, qtys],
  );

  const total = entered.reduce((s, e) => s + lineTotal(e.qty, e.line.unitCost), 0);

  const overCap = entered.some(
    (e) => !isReturnQtyValid(e.qty, e.line.qty, e.line.returnedQty),
  );

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await rpcPostPurchaseReturn({
        invoiceId,
        returnDate,
        reason,
        lines: entered.map((e) => ({ invoiceLineId: e.line.id, qty: e.qty })),
      });
      toast(`Returned ${money(total)} — stock reduced`, "success");
      await reloadStore();
      setInvoiceId("");
      setInvoice(null);
      setQtys({});
      setReason("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't post this return.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[18px]">
      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="pr-supplier">Supplier</label>
          <select id="pr-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose supplier…</option>
            {returnable.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="pr-invoice">Invoice</label>
          <select id="pr-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">Choose invoice…</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNo} · {i.purchaseDate} · {money(i.total)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {invoice && (
        <>
          <span className={labelCls}>Lines to return</span>
          <div className="mb-3.5 overflow-hidden rounded-xl border border-line">
            {invoice.lines.map((l) => {
              const left = returnableQty(l.qty, l.returnedQty);
              const qty = parseFloat(qtys[l.id] ?? "") || 0;
              const bad = qty > 0 && !isReturnQtyValid(qty, l.qty, l.returnedQty);
              return (
                <div
                  key={l.id}
                  className="flex items-center gap-3 border-t border-line-soft px-3 py-2.5 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold text-ink">{l.itemName}</div>
                    <div className="text-[12px] font-semibold text-ink-light">
                      Bought {l.qty} at {money(l.unitCost)}
                      {l.returnedQty > 0 ? ` · ${l.returnedQty} already returned` : ""}
                      {` · ${left} returnable`}
                    </div>
                  </div>
                  <input
                    aria-label={`Return quantity for ${l.itemName}`}
                    type="number" min="0" max={left} step="0.001" placeholder="0"
                    disabled={left <= 0}
                    className={`w-[92px] shrink-0 ${bad ? "border-danger" : ""}`}
                    value={qtys[l.id] ?? ""}
                    onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="pr-date">Return date</label>
          <input
            id="pr-date" type="date" max={today}
            value={returnDate} onChange={(e) => setReturnDate(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="pr-reason">Reason</label>
          <input
            id="pr-reason" type="text" placeholder="e.g. Damaged in transit"
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-3.5 flex justify-between rounded-xl bg-cream px-3.5 py-3 text-[13px] font-extrabold text-ink">
        <span>Credit note total</span><span>{money(total)}</span>
      </div>

      {overCap && (
        <div className="mb-2.5 text-[13px] font-semibold text-danger">
          One or more quantities are above what can still be returned.
        </div>
      )}
      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}

      <button
        type="button"
        className="btn-success flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={submit}
        disabled={busy || !invoiceId || entered.length === 0 || overCap || !reason.trim()}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {busy ? "Posting…" : "Post return"}
      </button>
      <p className="mt-2 text-center text-[12px] text-ink-muted">
        Posting removes the stock and credits the supplier.
      </p>
    </div>
  );
}
