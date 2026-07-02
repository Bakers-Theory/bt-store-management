"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { CATS, EMOJIS, UNITS } from "@/lib/constants";

export function ItemModal({
  itemId,
  onClose,
}: {
  itemId: string | null; // null = add new
  onClose: () => void;
}) {
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const saveItem = useBakeryStore((s) => s.saveItem);
  const toast = useUIStore((s) => s.toast);

  const editing = itemId ? items.find((i) => i.id === itemId) : undefined;

  const [emoji, setEmoji] = useState(editing?.emoji ?? "📦");
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? CATS[0]);
  const [unit, setUnit] = useState(editing?.unit ?? UNITS[0]);
  const [costPrice, setCostPrice] = useState(
    editing ? String(editing.costPrice) : "",
  );
  const [price, setPrice] = useState(editing ? String(editing.price) : "");
  const [qty, setQty] = useState(editing ? String(editing.qty) : "");
  const [nameErr, setNameErr] = useState("");

  const dup =
    !itemId && name.trim()
      ? items.find(
          (i) => i.name.trim().toLowerCase() === name.trim().toLowerCase(),
        )
      : undefined;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameErr("Item name is required");
      return;
    }
    const r = saveItem(
      {
        name: trimmed,
        emoji,
        category,
        unit,
        price: parseFloat(price) || 0,
        costPrice: parseFloat(costPrice) || 0,
        qty: parseFloat(qty) || 0,
      },
      itemId ?? undefined,
    );
    if (r.kind === "merged")
      toast(`ℹ️ "${r.name}" already exists — added ${r.qty} ${r.unit} to its stock`);
    else toast(r.kind === "updated" ? "✅ Item updated" : "✅ Item added");
    onClose();
  };

  return (
    <Modal title={itemId ? "Edit Item" : "Add New Item"} onClose={onClose}>
      <div className="form-group">
        <label className="form-label">Icon</label>
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={`cursor-pointer rounded-lg border-2 bg-transparent p-1 text-[22px] ${
                e === emoji ? "border-brown" : "border-transparent"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Item Name *</label>
        <input
          type="text"
          placeholder="e.g. Chocolate Croissant"
          list={!itemId ? "existingItemNames" : undefined}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameErr("");
          }}
        />
        {!itemId && (
          <datalist id="existingItemNames">
            {items.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
        )}
        {nameErr && <div className="mb-2.5 text-[13px] font-semibold text-danger">{nameErr}</div>}
        {dup && (
          <div className="mt-1 text-xs text-warn">
            ℹ️ &quot;{dup.name}&quot; already exists ({dup.qty} {dup.unit} in stock) — saving
            will add to its stock instead of creating a new item.
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Unit</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Bought Price ({currency})</label>
          <input
            type="number"
            placeholder="0.00"
            min="0"
            step="0.01"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Selling Price ({currency})</label>
          <input
            type="number"
            placeholder="0.00"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">{itemId ? "Current Stock" : "Initial Stock"}</label>
        <input
          type="number"
          placeholder="0"
          min="0"
          step="0.01"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>

      <div className="mb-2.5 text-[11px] text-ink-light">
        🔒 Bought price is for your records only — it never appears on printed bills.
      </div>
      <button className="btn-primary w-full" onClick={save}>
        {itemId ? "💾 Save Changes" : "✅ Add Item"}
      </button>
    </Modal>
  );
}
