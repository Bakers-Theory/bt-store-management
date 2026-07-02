"use client";

import { useState } from "react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { computeTotals } from "@/lib/bill";
import { Modal } from "@/components/ui/Modal";
import { Receipt } from "./Receipt";
import { BillItemModal } from "./BillItemModal";
import type { Bill as BillType, BillLine } from "@/lib/types";

export function Bill() {
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const taxRate = useBakeryStore((s) => s.bakery.taxRate);
  const generateBill = useBakeryStore((s) => s.generateBill);
  const toast = useUIStore((s) => s.toast);
  const requestPrint = useUIStore((s) => s.requestPrint);

  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [lines, setLines] = useState<BillLine[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [receipt, setReceipt] = useState<BillType | null>(null);

  const { subtotal, tax, total } = computeTotals(lines, taxRate);

  const openAdd = () => {
    if (items.length === 0) {
      toast("No items in inventory. Add items first.");
      return;
    }
    setAddOpen(true);
  };

  const addLine = (line: BillLine) => {
    setLines((prev) => {
      const idx = prev.findIndex((bi) => bi.itemId === line.itemId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + line.qty };
        return copy;
      }
      return [...prev, line];
    });
  };

  const setQty = (idx: number, val: string) =>
    setLines((prev) => prev.map((bi, i) => (i === idx ? { ...bi, qty: parseFloat(val) || 0 } : bi)));

  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  const generate = () => {
    if (lines.length === 0) return;
    const bill = generateBill(customer, lines);
    setLines([]);
    setCustomer({ name: "", phone: "" });
    setReceipt(bill);
  };

  return (
    <>
      <div className="card">
        <h3 className="mb-3">Customer Details</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              placeholder="Customer name"
              value={customer.name}
              onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input
              type="tel"
              placeholder="Phone no."
              value={customer.phone}
              onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Bill Items</h3>
          <button className="btn-sm btn-primary" onClick={openAdd}>➕ Add</button>
        </div>

        {lines.length === 0 ? (
          <div className="p-5 text-center text-sm text-ink-muted">
            Tap ➕ Add to add items
          </div>
        ) : (
          lines.map((bi, idx) => (
            <div className="mb-2 flex items-center gap-2" key={idx}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">
                  {bi.emoji || "📦"} {bi.name}
                </div>
                <div className="text-[11px] text-ink-muted">
                  {currency}{bi.price.toFixed(2)} each
                </div>
              </div>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={bi.qty}
                className="w-[65px] shrink-0 text-center"
                onChange={(e) => setQty(idx, e.target.value)}
              />
              <div className="min-w-[65px] text-right text-sm font-semibold">
                {currency}{(bi.qty * bi.price).toFixed(2)}
              </div>
              <button
                className="cursor-pointer rounded-lg border-none bg-danger px-2.5 py-1.5 text-sm text-white"
                onClick={() => removeLine(idx)}
              >
                ✕
              </button>
            </div>
          ))
        )}

        {lines.length > 0 && (
          <>
            <div className="mt-3 rounded-xl bg-cream-dark p-3.5">
              <div className="flex justify-between py-[3px] text-sm"><span>Subtotal</span><span>{currency}{subtotal.toFixed(2)}</span></div>
              {taxRate > 0 && (
                <div className="flex justify-between py-[3px] text-sm"><span>Tax ({taxRate}%)</span><span>{currency}{tax.toFixed(2)}</span></div>
              )}
              <div className="mt-2 flex justify-between border-t-[1.5px] border-line-strong pt-2 text-lg font-bold"><span>Total</span><span>{currency}{total.toFixed(2)}</span></div>
            </div>
            <button className="btn-primary mt-3 w-full p-3.5 text-base" onClick={generate}>
              🧾 Generate Bill
            </button>
          </>
        )}
      </div>

      {addOpen && <BillItemModal onClose={() => setAddOpen(false)} onAdd={addLine} />}

      {receipt && (
        <Modal title={`Bill #${receipt.billNo}`} onClose={() => setReceipt(null)}>
          <Receipt bill={receipt} />
          <div className="mt-4 flex gap-2.5">
            <button className="btn-primary flex-1" onClick={() => requestPrint(receipt)}>🖨 Print</button>
            <button className="btn-secondary flex-1" onClick={() => setReceipt(null)}>✅ Done</button>
          </div>
          <div className="mt-2.5 text-center text-xs text-ink-muted">
            Print to a 3&quot; (76mm) thermal printer
          </div>
        </Modal>
      )}
    </>
  );
}
