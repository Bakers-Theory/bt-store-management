"use client";

import { useState } from "react";
import { Loader2, Pencil, Power } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { useUIStore } from "@/lib/ui-store";
import { rpcSetSupplierStatus } from "@/lib/supabase-data";
import { supplierTypeLabel } from "@/lib/supplier";
import { SupplierModal } from "./SupplierModal";
import type { Supplier } from "@/lib/types";

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4 border-t border-line-soft py-2.5 first:border-t-0">
    <span className="text-[12.5px] font-semibold text-ink-light">{label}</span>
    <span className="text-right text-[13.5px] font-semibold text-ink">{value || "—"}</span>
  </div>
);

export function SupplierProfileTab({
  supplier,
  onChanged,
}: {
  supplier: Supplier;
  onChanged: () => void;
}) {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  const canEdit = hasPermission(user, "suppliers.edit");
  const canStatus = hasPermission(user, "suppliers.status");

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const isExternal = supplier.supplierType === "external";
  const nextStatus = supplier.status === "active" ? "inactive" : "active";

  const toggleStatus = async () => {
    setBusy(true);
    try {
      await rpcSetSupplierStatus(supplier.id, nextStatus);
      toast(
        nextStatus === "inactive" ? `${supplier.name} deactivated` : `${supplier.name} reactivated`,
        "success",
      );
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change the status", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rounded-[18px] border border-line bg-warm-white p-[18px]">
        <Row label="Code" value={supplier.code} />
        <Row label="Type" value={supplierTypeLabel(supplier.supplierType)} />
        <Row label="Status" value={supplier.status === "active" ? "Active" : "Inactive"} />
        <Row label="Name" value={supplier.name} />
        <Row label="Contact person" value={supplier.contactPerson} />
        {isExternal && (
          <>
            <Row label="Business name" value={supplier.businessName} />
            <Row label="Mobile" value={supplier.mobile} />
            <Row label="Email" value={supplier.email} />
            <Row label="GSTIN" value={supplier.gstin} />
            <Row
              label="Address"
              value={[supplier.address, supplier.city, supplier.state, supplier.pinCode]
                .filter(Boolean)
                .join(", ")}
            />
            <Row label="Payment terms" value={supplier.paymentTerms} />
          </>
        )}
        <Row label="Notes" value={supplier.notes} />
      </div>

      {(canEdit || canStatus) && (
        <div className="mt-3.5 flex gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-warm-white px-4 py-2.5 text-sm font-bold text-ink"
            >
              <Pencil size={15} /> Edit
            </button>
          )}
          {canStatus && (
            <button
              type="button"
              onClick={toggleStatus}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-warm-white px-4 py-2.5 text-sm font-bold text-ink-muted disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
              {supplier.status === "active" ? "Deactivate" : "Reactivate"}
            </button>
          )}
        </div>
      )}

      {/* Deliberately no Delete: FR-26 and NFR-6 need this history to survive. */}

      {editing && (
        <SupplierModal
          supplier={supplier}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
    </>
  );
}
