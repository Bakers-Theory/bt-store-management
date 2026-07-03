"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";

export function StockInForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const items = useBakeryStore((s) => s.items);
  const stockIn = useBakeryStore((s) => s.stockIn);
  const toast = useUIStore((s) => s.toast);

  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    const r = await stockIn(itemId, parseFloat(qty), supplier, notes);
    if (!r.ok) {
      setErr(r.error ?? "");
      return;
    }
    toast(`Added ${r.qty} ${r.unit} of ${r.name}`);
    setItemId("");
    setQty("");
    setSupplier("");
    setNotes("");
    setErr("");
    onSuccess?.();
  };

  return (
    <div>
      <div className="mb-3.5">
        <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Select Item</label>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Choose item...</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.emoji || "📦"} {i.name} ({i.qty} {i.unit})
            </option>
          ))}
        </select>
      </div>
      <div className="mb-3.5 grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Quantity</label>
          <input type="number" placeholder="0" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Supplier (optional)</label>
          <input type="text" placeholder="Supplier name" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
      </div>
      <div className="mb-3.5">
        <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Notes (optional)</label>
        <input type="text" placeholder="e.g. Morning delivery" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}
      <button className="btn-success flex w-full items-center justify-center gap-2" onClick={submit}>
        <Check size={16} /> Confirm Stock In
      </button>
    </div>
  );
}
