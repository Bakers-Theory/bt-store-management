"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { rpcPostPurchaseInvoice, rpcSavePurchaseInvoice } from "@/lib/supabase-data";
import { invoiceTotals, validateInvoiceDraft, type DraftLine } from "@/lib/purchase";
import { linesFrom } from "@/lib/item-purchase";
import { isoDateLocal } from "@/lib/excel";
import { ItemModal } from "@/components/feature/stock/ItemModal";
import { BulkImportModal } from "@/components/feature/BulkImportModal";
import type { Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const errCls = "mt-1 text-[12px] font-semibold text-danger";

const emptyLine = (): DraftLine => ({
  itemId: "",
  qty: 0,
  unitCost: 0,
  gstRate: 0,
  expiry: null,
});

export function PurchaseInvoiceForm({
  suppliers,
  onPosted,
}: {
  suppliers: Supplier[];
  onPosted: () => void;
}) {
  const user = useCurrentUser();
  const items = useBakeryStore((s) => s.items);
  const categories = useBakeryStore((s) => s.lists.categories);
  const units = useBakeryStore((s) => s.lists.units);
  const canCreateItem = hasPermission(user, "items.create");
  // Posting creates stock, so the store's item quantities and cost prices are
  // stale the moment it succeeds.
  const reloadStore = useBakeryStore((s) => s.load);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);

  const today = isoDateLocal(new Date());

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  // Only active suppliers can receive a new purchase — the RPC refuses an
  // inactive one, so offering it would be an error waiting to happen.
  const selectable = useMemo(() => suppliers.filter((s) => s.status === "active"), [suppliers]);
  const supplier = selectable.find((s) => s.id === supplierId) ?? null;
  const isInHouse = supplier?.supplierType === "in_house";

  const totals = useMemo(
    () => invoiceTotals(lines, supplier?.supplierType ?? "external"),
    [lines, supplier],
  );

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  /**
   * Products arriving from the New product modal or the CSV import become lines
   * here. The blank line the form starts with is dropped rather than left above
   * them, so an import of six products reads as six lines and not seven.
   */
  const addLines = (incoming: DraftLine[]) => {
    if (incoming.length === 0) return;
    setLines((ls) => {
      const kept = ls.filter((l) => l.itemId !== "");
      return [...kept, ...incoming];
    });
  };

  const reset = () => {
    setSupplierId("");
    setInvoiceNo("");
    setPurchaseDate(today);
    setNotes("");
    setLines([emptyLine()]);
    setErrors({});
    setServerError("");
  };

  const submit = async () => {
    const draft = {
      supplierId,
      supplierType: supplier?.supplierType ?? ("external" as const),
      // An in-house receipt carries no supplier invoice number; the DB assigns
      // an IH- reference of its own.
      invoiceNo: isInHouse ? "" : invoiceNo,
      purchaseDate,
      lines,
    };
    const found = validateInvoiceDraft(draft, today);
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    setServerError("");
    try {
      const saved = await rpcSavePurchaseInvoice({
        supplierId,
        invoiceNo: draft.invoiceNo,
        purchaseDate,
        notes,
        // GST is stripped for in-house so nothing misleading is ever sent.
        lines: isInHouse ? lines.map((l) => ({ ...l, gstRate: 0 })) : lines,
      });
      const posted = await rpcPostPurchaseInvoice(saved.id);
      toast(
        `Posted ${posted.internalRef ?? posted.invoiceNo} — stock updated`,
        "success",
      );
      await reloadStore();
      reset();
      onPosted();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Couldn't post this purchase.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[18px]">
      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="pi-supplier">Supplier</label>
          <select
            id="pi-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose supplier…</option>
            {selectable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code}){s.supplierType === "in_house" ? " · in-house" : ""}
              </option>
            ))}
          </select>
          {errors.supplierId && <div className={errCls}>{errors.supplierId}</div>}
        </div>
        <div>
          <label className={labelCls} htmlFor="pi-date">Purchase date</label>
          <input
            id="pi-date"
            type="date"
            max={today}
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
          {errors.purchaseDate && <div className={errCls}>{errors.purchaseDate}</div>}
        </div>
      </div>

      {/* The whole invoice-number / GST apparatus is absent for in-house, not
          merely disabled: there is nothing to fill in. */}
      {supplier && !isInHouse && (
        <div className="mb-3.5">
          <label className={labelCls} htmlFor="pi-no">Supplier invoice number</label>
          <input
            id="pi-no"
            type="text"
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="As printed on their invoice"
          />
          {errors.invoiceNo && <div className={errCls}>{errors.invoiceNo}</div>}
        </div>
      )}

      {isInHouse && (
        <p className="mb-3.5 rounded-xl bg-cream px-3.5 py-2.5 text-[12.5px] font-semibold text-ink-muted">
          In-house receipt — a reference is assigned automatically, and there is no
          GST and nothing payable.
        </p>
      )}

      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className={labelCls + " mb-0"}>Products</span>
        {/* The dropdown below only offers products that already exist. A delivery
            that brings something new would otherwise mean leaving for Stock and
            starting this invoice again. */}
        {canCreateItem && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-warm-white px-3 py-1.5 text-[12.5px] font-bold text-ink-muted"
            >
              <Plus size={14} /> New product
            </button>
            <button
              type="button"
              onClick={() => setImporting(true)}
              disabled={!supplier}
              title={supplier ? undefined : "Choose the supplier first"}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-warm-white px-3 py-1.5 text-[12.5px] font-bold text-ink-muted disabled:opacity-50"
            >
              <Upload size={14} /> Import
            </button>
          </div>
        )}
      </div>

      {creating && (
        <ItemModal
          itemId={null}
          noOpeningStock
          onSaved={(id) => id && addLines([{ ...emptyLine(), itemId: id }])}
          onClose={() => setCreating(false)}
        />
      )}

      {/* The same CSV import the supplier's Products tab uses, in hand-off mode:
          it creates the products with no stock and returns them as lines, so this
          invoice stays the one document that brings the delivery in. */}
      {importing && supplier && (
        <BulkImportModal
          mode="items"
          context={{
            categories,
            units,
            existingItemNames: items.map((i) => i.name),
            linkToSupplier: supplier,
          }}
          onImported={(stock) => addLines(linesFrom(stock))}
          onDone={() => {}}
          onClose={() => setImporting(false)}
        />
      )}

      {lines.map((l, i) => {
        const item = items.find((it) => it.id === l.itemId);
        return (
          <div key={i} className="mb-2 rounded-xl border border-line bg-cream/40 p-2.5">
            <div className="mb-2 flex gap-2">
              <select
                aria-label={`Product for line ${i + 1}`}
                className="min-w-0 flex-1"
                value={l.itemId}
                onChange={(e) => setLine(i, { itemId: e.target.value })}
              >
                <option value="">Choose product…</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.emoji || "📦"} {it.name}
                  </option>
                ))}
              </select>
              {lines.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
                  className="shrink-0 rounded-[11px] border border-line bg-warm-white px-2.5 text-ink-light"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className={`grid gap-2 ${isInHouse ? "grid-cols-2" : "grid-cols-3"}`}>
              <div>
                <label className={labelCls} htmlFor={`pi-qty-${i}`}>
                  Qty{item ? ` (${item.unit})` : ""}
                </label>
                <input
                  id={`pi-qty-${i}`}
                  type="number" min="0" step="0.001" placeholder="0"
                  value={l.qty || ""}
                  onChange={(e) => setLine(i, { qty: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor={`pi-cost-${i}`}>Unit cost</label>
                <input
                  id={`pi-cost-${i}`}
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={l.unitCost || ""}
                  onChange={(e) => setLine(i, { unitCost: parseFloat(e.target.value) || 0 })}
                />
              </div>
              {!isInHouse && (
                <div>
                  <label className={labelCls} htmlFor={`pi-gst-${i}`}>GST %</label>
                  <input
                    id={`pi-gst-${i}`}
                    type="number" min="0" max="100" step="0.01" placeholder="0"
                    value={l.gstRate || ""}
                    onChange={(e) => setLine(i, { gstRate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              )}
            </div>
            {item?.tracksExpiry && (
              <div className="mt-2">
                <label className={labelCls} htmlFor={`pi-exp-${i}`}>Batch expiry date</label>
                <input
                  id={`pi-exp-${i}`}
                  type="date"
                  value={l.expiry ?? ""}
                  onChange={(e) => setLine(i, { expiry: e.target.value || null })}
                />
              </div>
            )}
          </div>
        );
      })}
      {errors.lines && <div className={errCls}>{errors.lines}</div>}

      <button
        type="button"
        onClick={() => setLines((ls) => [...ls, emptyLine()])}
        className="mt-1 inline-flex items-center gap-1.5 rounded-xl border border-line bg-warm-white px-3.5 py-2 text-[13px] font-bold text-ink-muted"
      >
        <Plus size={14} /> Add line
      </button>

      <div className="mt-3.5">
        <label className={labelCls} htmlFor="pi-notes">Notes (optional)</label>
        <input
          id="pi-notes"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Morning delivery"
        />
      </div>

      <div className="mt-3.5 rounded-xl bg-cream px-3.5 py-3 text-[13px] font-semibold text-ink">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
        <div className="flex justify-between">
          <span>GST</span>
          <span>{totals.gstAmount == null ? "—" : money(totals.gstAmount)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-extrabold">
          <span>Total</span><span>{money(totals.total)}</span>
        </div>
      </div>

      {serverError && <div className="mt-2.5 text-[13px] font-semibold text-danger">{serverError}</div>}

      <button
        type="button"
        className="btn-success mt-3.5 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={submit}
        disabled={busy}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {busy ? "Posting…" : "Post purchase & add stock"}
      </button>
      <p className="mt-2 text-center text-[12px] text-ink-muted">
        Posting adds the stock and updates each product&apos;s purchase price.
      </p>
    </div>
  );
}
