"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { rpcCreateSupplier, rpcUpdateSupplier } from "@/lib/supabase-data";
import {
  EMPTY_SUPPLIER,
  SUPPLIER_TYPES,
  supplierTypeLabel,
  validateSupplier,
  type SupplierInput,
} from "@/lib/supplier";
import type { Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const errCls = "mt-1 text-[12px] font-semibold text-danger";

const toInput = (s: Supplier): SupplierInput => ({
  supplierType: s.supplierType,
  name: s.name,
  businessName: s.businessName,
  contactPerson: s.contactPerson,
  mobile: s.mobile,
  email: s.email,
  gstin: s.gstin,
  address: s.address,
  city: s.city,
  state: s.state,
  pinCode: s.pinCode,
  paymentTerms: s.paymentTerms,
  notes: s.notes,
});

export function SupplierModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: (saved: Supplier) => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const [form, setForm] = useState<SupplierInput>(
    supplier ? toInput(supplier) : EMPTY_SUPPLIER,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);

  const isExternal = form.supplierType === "external";
  const set = (field: keyof SupplierInput, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const field = (
    key: keyof SupplierInput,
    label: string,
    extra: { type?: string; placeholder?: string } = {},
  ) => (
    <div>
      <label className={labelCls} htmlFor={`sup-${key}`}>{label}</label>
      <input
        id={`sup-${key}`}
        type={extra.type ?? "text"}
        placeholder={extra.placeholder}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value)}
      />
      {errors[key] && <div className={errCls}>{errors[key]}</div>}
    </div>
  );

  const submit = async () => {
    const found = validateSupplier(form);
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    setServerError("");
    try {
      const saved = supplier
        ? await rpcUpdateSupplier(supplier.id, form, supplier.updatedAt)
        : await rpcCreateSupplier(form);
      toast(supplier ? `Updated ${saved.name}` : `Added ${saved.name} (${saved.code})`, "success");
      onSaved(saved);
      onClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Couldn't save this supplier.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={supplier ? `Edit ${supplier.name}` : "Add supplier"} onClose={onClose}>
      <div className="mb-3.5">
        <span className={labelCls}>Supplier type</span>
        <div className="flex gap-2">
          {SUPPLIER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              // Changing type on an existing record would move it between the
              // financial aggregates, so it is set once at creation.
              disabled={Boolean(supplier)}
              onClick={() => setForm((f) => ({ ...f, supplierType: t }))}
              className={`flex-1 rounded-[11px] border px-3 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
                form.supplierType === t
                  ? "border-brown bg-cream text-brown"
                  : "border-line bg-warm-white text-ink-muted"
              }`}
            >
              {supplierTypeLabel(t)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted">
          {isExternal
            ? "A vendor you buy from and owe money to."
            : "Your own production — cost is tracked, but there is no invoice, no GST and nothing payable."}
        </p>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {field("name", "Name")}
        {field("contactPerson", "Contact person")}
      </div>

      {isExternal && (
        <>
          <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {field("businessName", "Business name")}
            {field("mobile", "Mobile", { placeholder: "10 digits" })}
          </div>
          <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {field("email", "Email (optional)")}
            {field("gstin", "GSTIN (optional)", { placeholder: "27AAPFU0939F1ZV" })}
          </div>
          <div className="mb-3.5">{field("address", "Address")}</div>
          <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {field("city", "City")}
            {field("state", "State")}
            {field("pinCode", "PIN code", { placeholder: "6 digits" })}
          </div>
          <div className="mb-3.5">{field("paymentTerms", "Payment terms")}</div>
        </>
      )}

      <div className="mb-3.5">{field("notes", "Notes (optional)")}</div>

      {serverError && <div className="mb-2.5 text-[13px] font-semibold text-danger">{serverError}</div>}

      <button
        type="button"
        className="btn-success flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={submit}
        disabled={busy}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {busy ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
      </button>
    </Modal>
  );
}
