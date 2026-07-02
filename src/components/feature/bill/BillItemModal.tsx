"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import type { BillLine } from "@/lib/types";

export function BillItemModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (line: BillLine) => void;
}) {
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);

  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState("");

  const selectItem = (id: string) => {
    setItemId(id);
    const it = items.find((i) => i.id === id);
    setPrice(it ? String(it.price) : "");
  };

  const add = () => {
    if (!itemId) {
      setErr("Please select an item");
      return;
    }
    const item = items.find((i) => i.id === itemId)!;
    const q = parseFloat(qty) || 1;
    const p = parseFloat(price) || item.price;
    onAdd({
      itemId,
      name: item.name,
      emoji: item.emoji,
      unit: item.unit,
      qty: q,
      price: p,
      costPrice: item.costPrice || 0,
    });
    onClose();
  };

  return (
    <Modal title="Add Item to Bill" onClose={onClose}>
      <div className="form-group">
        <label className="form-label">Select Item</label>
        <select value={itemId} onChange={(e) => selectItem(e.target.value)}>
          <option value="">Choose item...</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.emoji || "📦"} {i.name} — {currency}
              {i.price.toFixed(2)} ({i.qty} {i.unit})
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Quantity</label>
          <input type="number" min="0.01" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Price ({currency})</label>
          <input type="number" placeholder="Auto" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}
      <button className="btn-primary w-full" onClick={add}>
        ➕ Add to Bill
      </button>
    </Modal>
  );
}
