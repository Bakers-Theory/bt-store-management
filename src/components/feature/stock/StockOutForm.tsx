"use client";

import { useState } from "react";
import { Loader2, PackageMinus } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";

export function StockOutForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const items = useBakeryStore((s) => s.items);
  const stockOut = useBakeryStore((s) => s.stockOut);
  const reasons = useBakeryStore((s) => s.lists.reasons);
  const toast = useUIStore((s) => s.toast);

  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await stockOut(itemId, parseFloat(qty), reason || reasons[0] || "", notes);
      if (!r.ok) {
        setErr(r.error ?? "");
        return;
      }
      toast(`Removed ${r.qty} ${r.unit} of ${r.name}`);
      setItemId("");
      setQty("");
      setReason("");
      setNotes("");
      setErr("");
      onSuccess?.();
    } finally {
      setBusy(false);
    }
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
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Reason</label>
          <select value={reason || reasons[0] || ""} onChange={(e) => setReason(e.target.value)}>
            {reasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-3.5">
        <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Notes (optional)</label>
        <input type="text" placeholder="Additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}
      <button
        className="btn-danger flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={submit}
        disabled={busy}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <PackageMinus size={16} />}
        {busy ? "Removing…" : "Confirm Stock Out"}
      </button>
    </div>
  );
}
