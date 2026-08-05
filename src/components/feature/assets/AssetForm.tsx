"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { ASSET_CONDITIONS, conditionLabel } from "@/lib/asset";
import { fetchSuppliers, rpcSaveAsset } from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { Asset, AssetCondition, Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

/**
 * Add or edit a register entry. It deliberately cannot touch status, holder or
 * the service dates — those belong to the assign/return/maintenance actions, and
 * `save_asset` would ignore them anyway (0061 notes 1 and 4).
 */
export function AssetForm({
  asset,
  onClose,
  onSaved,
}: {
  asset: Asset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const lists = useBakeryStore((s) => s.lists);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  const [name, setName] = useState(asset?.name ?? "");
  const [category, setCategory] = useState(asset?.category ?? "");
  const [brand, setBrand] = useState(asset?.brand ?? "");
  const [model, setModel] = useState(asset?.model ?? "");
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? "");
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate ?? today);
  const [purchasePrice, setPurchasePrice] = useState(
    asset ? String(asset.purchasePrice) : "",
  );
  const [vendorId, setVendorId] = useState(asset?.vendorId ?? "");
  const [warrantyStart, setWarrantyStart] = useState(asset?.warrantyStart ?? "");
  const [warrantyExpiry, setWarrantyExpiry] = useState(asset?.warrantyExpiry ?? "");
  const [location, setLocation] = useState(asset?.location ?? "");
  const [department, setDepartment] = useState(asset?.department ?? "");
  const [condition, setCondition] = useState<AssetCondition>(asset?.condition ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Optional enrichment: a failed vendor list must not block the form.
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  const price = Number(purchasePrice);

  // The client half of `save_asset`'s validation — same order, same rules, so the
  // form refuses what the server would refuse without the round trip.
  const error =
    name.trim() === ""
      ? "Give the asset a name"
      : category === ""
        ? "Choose a category"
        : location.trim() === ""
          ? "Say where it is kept"
          : purchaseDate === ""
            ? "Say when it was bought"
            : purchaseDate > today
              ? "A purchase date cannot be in the future"
              : purchasePrice === "" || !Number.isFinite(price) || price < 0
                ? "Enter what it cost"
                : warrantyStart && warrantyExpiry && warrantyExpiry < warrantyStart
                  ? "The warranty cannot end before it starts"
                  : warrantyExpiry && warrantyExpiry < purchaseDate
                    ? "The warranty cannot end before the asset was bought"
                    : null;

  const submit = async () => {
    if (error) return;
    setSaving(true);
    try {
      await rpcSaveAsset({
        id: asset?.id,
        name: name.trim(),
        category,
        brand: brand.trim(),
        model: model.trim(),
        serialNumber: serialNumber.trim(),
        purchaseDate,
        purchasePrice: price,
        vendorId: vendorId || null,
        warrantyStart: warrantyStart || null,
        warrantyExpiry: warrantyExpiry || null,
        location: location.trim(),
        department: department.trim(),
        condition,
        notes: notes.trim(),
        // The form does not collect files yet; preserve whatever is stored so an
        // edit never wipes attachments added elsewhere.
        imageUrl: asset?.imageUrl ?? null,
        documents: asset?.documents ?? [],
      });
      toast(asset ? "Asset updated" : "Asset added", "success");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the asset", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={asset ? `Edit ${asset.code}` : "Add asset"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="as-name">What is it</label>
          <input
            id="as-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Counter POS machine"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-cat">Category</label>
            <select
              id="as-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose…</option>
              {lists.assetCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {lists.assetCategories.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Add asset categories in Settings first.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-cond">Condition</label>
            <select
              id="as-cond"
              value={condition}
              onChange={(e) => setCondition(e.target.value as AssetCondition)}
              className={inputCls}
            >
              <option value="">Not recorded</option>
              {ASSET_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {conditionLabel(c)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-brand">Brand (optional)</label>
            <input
              id="as-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-model">Model (optional)</label>
            <input
              id="as-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="as-serial">Serial number (optional)</label>
          <input
            id="as-serial"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-ink-muted">
            No two assets can share one, and it is searchable.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-pdate">Bought on</label>
            <input
              id="as-pdate"
              type="date"
              max={today}
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-price">Cost ({currency})</label>
            <input
              id="as-price"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="as-vendor">Bought from (optional)</label>
          <select
            id="as-vendor"
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
            <label className={labelCls} htmlFor="as-wstart">Warranty from (optional)</label>
            <input
              id="as-wstart"
              type="date"
              value={warrantyStart}
              onChange={(e) => setWarrantyStart(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-wend">Warranty until (optional)</label>
            <input
              id="as-wend"
              type="date"
              value={warrantyExpiry}
              onChange={(e) => setWarrantyExpiry(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-loc">Kept at</label>
            <input
              id="as-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Front counter"
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="as-dept">Department (optional)</label>
            <input
              id="as-dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Kitchen"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="as-notes">Notes (optional)</label>
          <input
            id="as-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
          />
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
          {asset ? "Save changes" : "Add asset"}
        </button>
        {!asset && (
          <p className="text-center text-[11px] text-ink-muted">
            It starts out available. Issue it to someone from its page.
          </p>
        )}
      </div>
    </Modal>
  );
}
