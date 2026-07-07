"use client";

import { useEffect, useState } from "react";
import { Lock, Save, Check, Info, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { fetchItemBatches } from "@/lib/supabase-data";
import { expiryStatus, type ExpiryStatus } from "@/lib/expiry";
import type { Batch } from "@/lib/types";

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
  const cats = useBakeryStore((s) => s.lists.categories);
  const emojis = useBakeryStore((s) => s.lists.emojis);
  const units = useBakeryStore((s) => s.lists.units);

  const editing = itemId ? items.find((i) => i.id === itemId) : undefined;

  const [emoji, setEmoji] = useState(editing?.emoji ?? "📦");
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? cats[0] ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? units[0] ?? "");
  const [costPrice, setCostPrice] = useState(
    editing ? String(editing.costPrice) : "",
  );
  const [price, setPrice] = useState(editing ? String(editing.price) : "");
  const [qty, setQty] = useState(editing ? String(editing.qty) : "");
  const [nameErr, setNameErr] = useState("");
  const [saving, setSaving] = useState(false);
  const writeOffBatch = useBakeryStore((s) => s.writeOffBatch);
  const expiringSoonDays = useBakeryStore((s) => s.bakery.expiringSoonDays);
  const [tracksExpiry, setTracksExpiry] = useState(editing?.tracksExpiry ?? true);
  const [expiryDate, setExpiryDate] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = () => {
    if (itemId) fetchItemBatches(itemId).then(setBatches);
  };
  useEffect(loadBatches, [itemId]);

  const dup =
    !itemId && name.trim()
      ? items.find(
          (i) => i.name.trim().toLowerCase() === name.trim().toLowerCase(),
        )
      : undefined;

  const canSave = editing
    ? name.trim().length > 0 &&
      (emoji !== editing.emoji ||
        name.trim() !== editing.name ||
        category !== editing.category ||
        unit !== editing.unit ||
        tracksExpiry !== editing.tracksExpiry ||
        costPrice !== String(editing.costPrice) ||
        price !== String(editing.price) ||
        qty !== String(editing.qty))
    : name.trim().length > 0;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameErr("Item name is required");
      return;
    }
    setSaving(true);
    try {
      const r = await saveItem(
        {
          name: trimmed,
          emoji,
          category,
          unit,
          price: parseFloat(price) || 0,
          costPrice: parseFloat(costPrice) || 0,
          qty: parseFloat(qty) || 0,
          tracksExpiry,
          expiryDate: tracksExpiry && expiryDate ? expiryDate : null,
        },
        itemId ?? undefined,
      );
      if (r.kind === "merged")
        toast(`"${r.name}" already exists — added ${r.qty} ${r.unit} to its stock`);
      else toast(r.kind === "updated" ? "Item updated" : "Item added");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save item");
      setSaving(false);
    }
  };

  return (
    <Modal title={itemId ? "Edit Item" : "Add New Item"} onClose={onClose}>
      <div className="mb-3.5">
        <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Icon</label>
        <div className="flex flex-wrap gap-1.5">
          {emojis.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-2 bg-warm-white text-[20px] ${
                e === emoji ? "border-brown" : "border-line"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3.5">
        <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Item Name *</label>
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
        {nameErr && <div className="mt-1.5 text-[13px] font-semibold text-danger">{nameErr}</div>}
        {dup && (
          <div className="mt-1.5 flex items-start gap-1.5 text-xs text-warn">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              &quot;{dup.name}&quot; already exists ({dup.qty} {dup.unit} in stock) — saving
              will add to its stock instead of creating a new item.
            </span>
          </div>
        )}
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Unit</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Bought Price ({currency})</label>
          <input
            type="number"
            placeholder="0.00"
            min="0"
            step="0.01"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Selling Price ({currency})</label>
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

      <div className="mb-3.5 flex items-center justify-between rounded-[11px] border border-line bg-cream px-3 py-2.5">
        <label htmlFor="tracksExpiry" className="text-[13px] font-semibold text-ink">
          This product expires
        </label>
        <input
          id="tracksExpiry"
          type="checkbox"
          checked={tracksExpiry}
          onChange={(e) => setTracksExpiry(e.target.checked)}
          className="h-4 w-4 accent-brown"
        />
      </div>

      {!itemId && tracksExpiry && parseFloat(qty) > 0 && (
        <div className="mb-3.5">
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">
            Initial batch expiry date
          </label>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
        </div>
      )}

      {itemId ? (
        <div className="mb-3.5">
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Current Stock</label>
          <div className="rounded-[11px] border border-line bg-cream px-3 py-2.5 text-sm font-bold text-ink-muted">
            {editing?.qty ?? 0} {unit}
          </div>
          <p className="mt-1 text-[11px] text-ink-light">
            Change stock via Add Stock, Stock Out, or writing off a batch below.
          </p>
        </div>
      ) : (
        <div className="mb-3.5">
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Initial Stock</label>
          <input
            type="number"
            placeholder="0"
            min="0"
            step="0.01"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
      )}

      {itemId && tracksExpiry && batches.length > 0 && (
        <div className="mb-3.5">
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Batches</label>
          <div className="overflow-hidden rounded-[11px] border border-line">
            {batches.map((b) => {
              const status: ExpiryStatus = expiryStatus(
                b.expiryDate, true, expiringSoonDays, new Date(),
              );
              const badge =
                status === "expired"
                  ? "bg-danger-bg text-danger"
                  : status === "expiring"
                    ? "bg-warn-bg text-warn"
                    : "bg-success-bg text-success";
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-2 border-t border-line-soft px-3 py-2 text-[12.5px] first:border-t-0"
                >
                  <span className="num font-bold text-ink">{b.qty} {unit}</span>
                  <span className="text-ink-muted">
                    {b.expiryDate ? `exp ${b.expiryDate}` : "no expiry"}
                  </span>
                  {b.expiryDate && (
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${badge}`}>
                      {status === "expired" ? "Expired" : status === "expiring" ? "Expiring" : "Fresh"}
                    </span>
                  )}
                  <button
                    type="button"
                    className="ml-auto text-[11.5px] font-bold text-danger"
                    onClick={async () => {
                      const r = await writeOffBatch(b.id);
                      if (r.ok) { toast("Batch written off"); loadBatches(); }
                      else toast(r.error ?? "Could not write off batch");
                    }}
                  >
                    Write off
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-1.5 text-[11px] text-ink-light">
        <Lock size={14} /> Bought price is for your records only — it never appears on printed bills.
      </div>
      <button
        className="btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={save}
        disabled={saving || !canSave}
      >
        {saving ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Saving…
          </>
        ) : itemId ? (
          <>
            <Save size={16} /> Save Changes
          </>
        ) : (
          <>
            <Check size={16} /> Add Item
          </>
        )}
      </button>
    </Modal>
  );
}
