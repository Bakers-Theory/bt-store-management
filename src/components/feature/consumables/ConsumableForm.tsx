"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { fetchSuppliers, rpcSaveConsumable } from "@/lib/supabase-data";
import type { BillMode, Consumable, Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

/** "" → null, so an untouched optional number stays absent rather than zero. */
const optional = (v: string): number | null => (v.trim() === "" ? null : Number(v));

/**
 * Add or edit a stock-tracked item. There is no stock field on purpose: current
 * stock is the ledger's sum (§3.2), so it is only ever changed by recording a
 * movement.
 */
export function ConsumableForm({
  item,
  onClose,
  onSaved,
}: {
  item: Consumable | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const lists = useBakeryStore((s) => s.lists);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);

  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [vendorId, setVendorId] = useState(item?.vendorId ?? "");
  const [minStock, setMinStock] = useState(item ? String(item.minStock) : "");
  const [maxStock, setMaxStock] = useState(item?.maxStock === null || !item ? "" : String(item.maxStock));
  const [reorderLevel, setReorderLevel] = useState(
    item?.reorderLevel === null || !item ? "" : String(item.reorderLevel),
  );
  const [reorderQty, setReorderQty] = useState(
    item?.reorderQty === null || !item ? "" : String(item.reorderQty),
  );
  const [costPerUnit, setCostPerUnit] = useState(
    item?.costPerUnit === null || !item ? "" : String(item.costPerUnit),
  );
  const [billMode, setBillMode] = useState<BillMode>(item?.billMode ?? "none");
  const [expiryDate, setExpiryDate] = useState(item?.expiryDate ?? "");
  const [storageLocation, setStorageLocation] = useState(item?.storageLocation ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  const min = Number(minStock || 0);
  const max = optional(maxStock);
  const reorder = optional(reorderLevel);
  const rqty = optional(reorderQty);

  // The unit is frozen once movements exist: changing it would silently
  // reinterpret every past entry (5 kg becoming 5 litres). The server refuses it
  // too — this only explains why the field is disabled.
  const unitLocked = !!item && item.lastMovementDate !== null;

  const error =
    name.trim() === ""
      ? "Give the item a name"
      : category === ""
        ? "Choose a category"
        : unit === ""
          ? "Choose a unit"
          : minStock === "" || !Number.isFinite(min) || min < 0
            ? "Set the minimum stock — it is what triggers the low-stock alert"
            : max !== null && max < min
              ? "The maximum cannot be below the minimum"
              : reorder !== null && max !== null && reorder > max
                ? "The reorder level cannot be above the maximum"
                : rqty !== null && rqty <= 0
                  ? "A reorder quantity has to be more than zero"
                  : // A charged line is priced from the cost, so billing without
                    // one would put a zero-value line on a customer's bill. The
                    // server refuses it too (save_consumable, 0067).
                    billMode === "charge" && !((optional(costPerUnit) ?? 0) > 0)
                    ? `Set a cost per ${unit || "unit"} before charging this item on a bill`
                    : null;

  const submit = async () => {
    if (error) return;
    setSaving(true);
    try {
      await rpcSaveConsumable({
        id: item?.id,
        name: name.trim(),
        category,
        unit,
        vendorId: vendorId || null,
        billMode,
        minStock: min,
        maxStock: max,
        reorderLevel: reorder,
        reorderQty: rqty,
        costPerUnit: optional(costPerUnit),
        expiryDate: expiryDate || null,
        storageLocation: storageLocation.trim(),
        notes: notes.trim(),
      });
      toast(item ? "Item updated" : "Item added", "success");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the item", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={item ? `Edit ${item.code}` : "Add consumable"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="cn-name">What is it</label>
          <input
            id="cn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cake boxes 8 inch"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-cat">Category</label>
            <select
              id="cn-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose…</option>
              {lists.consumableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {lists.consumableCategories.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Add consumable categories in Settings first.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-unit">Counted in</label>
            <select
              id="cn-unit"
              value={unit}
              disabled={unitLocked}
              onChange={(e) => setUnit(e.target.value)}
              className={`${inputCls} disabled:opacity-60`}
            >
              <option value="">Choose…</option>
              {lists.units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {unitLocked && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Fixed — this item already has stock movements in {item!.unit}.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-min">Minimum stock</label>
            <input
              id="cn-min"
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-ink-muted">Below this, you get an alert.</p>
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-max">Maximum stock (optional)</label>
            <input
              id="cn-max"
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={maxStock}
              onChange={(e) => setMaxStock(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-ink-muted">Used to size a reorder.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-reorder">Reorder level (optional)</label>
            <input
              id="cn-reorder"
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={reorderLevel}
              onChange={(e) => setReorderLevel(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              Can sit above the minimum — order before you run low.
            </p>
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-rqty">Reorder quantity (optional)</label>
            <input
              id="cn-rqty"
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={reorderQty}
              onChange={(e) => setReorderQty(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              How much you normally buy at a time.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-cost">
              Cost per {unit || "unit"} ({currency}, optional)
            </label>
            <input
              id="cn-cost"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={costPerUnit}
              onChange={(e) => setCostPerUnit(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-exp">Expires on (optional)</label>
            <input
              id="cn-exp"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-ink-muted">Perishables only.</p>
          </div>
        </div>

        <div>
          <span className={labelCls}>At the billing counter</span>
          <div className="inline-flex overflow-hidden rounded-[11px] border border-line">
            {(
              [
                ["none", "Not offered"],
                ["charge", "Charge customer"],
                ["absorb", "Absorb as cost"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setBillMode(mode)}
                aria-pressed={billMode === mode}
                className={`px-3 py-2 text-xs font-bold ${
                  billMode === mode ? "bg-brown text-white" : "bg-warm-white text-ink-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">
            {billMode === "none"
              ? "Billers will not see this item at checkout."
              : billMode === "charge"
                ? `Added to the bill at cost${
                    (optional(costPerUnit) ?? 0) > 0
                      ? ` (${currency}${optional(costPerUnit)} per ${unit || "unit"})`
                      : ""
                  } and printed on the receipt.`
                : "Deducted from stock without printing; the cost leaves the cash book."}
          </p>
        </div>

        <div>
          <label className={labelCls} htmlFor="cn-vendor">Usually bought from (optional)</label>
          <select
            id="cn-vendor"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className={inputCls}
          >
            <option value="">Not recorded</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-store">Kept at (optional)</label>
            <input
              id="cn-store"
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="cn-notes">Notes (optional)</label>
            <input
              id="cn-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {error && name !== "" && (
          <p className="text-[11px] font-semibold text-red-700">{error}</p>
        )}

        <button
          disabled={!!error || saving}
          onClick={() => void submit()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {item ? "Save changes" : "Add item"}
        </button>
        {!item && (
          <p className="text-center text-[11px] text-ink-muted">
            It starts at zero. Record a purchase to put stock on the shelf.
          </p>
        )}
      </div>
    </Modal>
  );
}
