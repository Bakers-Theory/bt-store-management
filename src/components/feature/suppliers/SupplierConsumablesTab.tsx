"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Plus, Upload } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { fetchConsumablesPage } from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConsumableForm } from "@/components/feature/consumables/ConsumableForm";
import { qtyLabel } from "@/components/feature/consumables/ConsumableList";
import { BulkImportModal } from "@/components/feature/BulkImportModal";
import type { Consumable, Supplier } from "@/lib/types";

/** One page is plenty: a supplier's consumables list is a shortlist, not a catalogue. */
const PAGE = 100;

/**
 * The consumables a supplier brings, and the way a delivery of them gets in.
 *
 * The mirror of the Products tab, with one difference that comes from the data
 * model rather than the design: a consumable names its vendor on the record
 * (`consumables.vendor_id`) instead of being linked through a join table, so
 * there is nothing to link or unlink here — a consumable moves supplier by being
 * edited. What this tab adds is the bulk insert: a CSV of everything this
 * supplier delivers, created against them and, if asked, filed as one purchase
 * invoice (0072) that brings the stock in and becomes the payable.
 */
export function SupplierConsumablesTab({ supplier }: { supplier: Supplier }) {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const categories = useBakeryStore((s) => s.lists.consumableCategories);
  const units = useBakeryStore((s) => s.lists.units);
  const canCreate = hasPermission(user, "consumables.create");

  const [rows, setRows] = useState<Consumable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    fetchConsumablesPage(0, PAGE, { vendorId: supplier.id })
      .then((r) => alive && (setRows(r.items), setLoaded(true)))
      .catch(() => alive && (setLoaded(true), toast("Couldn't load consumables", "error")));
    return () => {
      alive = false;
    };
  }, [supplier.id, token, toast]);

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  if (!loaded) return <Skeleton className="h-40 w-full rounded-[18px]" />;

  return (
    <>
      {canCreate && supplier.status === "active" && (
        <div className="mb-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border-none bg-brown px-4 py-2.5 text-sm font-bold text-warm-white"
          >
            <Plus size={15} /> New consumable
          </button>
          {/* A supplier's consumables arrive as a list — the same CSV import the
              Consumables page uses, with this supplier already filled in. */}
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-warm-white px-4 py-2.5 text-sm font-bold text-ink-muted"
          >
            <Upload size={15} /> Import
          </button>
        </div>
      )}

      {creating && (
        <ConsumableForm
          item={null}
          vendor={supplier}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {importing && (
        <BulkImportModal
          mode="consumables"
          context={{ categories, units, linkToSupplier: supplier }}
          onDone={reload}
          onClose={() => setImporting(false)}
        />
      )}

      {rows.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-ink-muted">
          <div className="mb-2.5 flex justify-center"><Boxes size={36} /></div>
          <p className="text-sm">No consumables bought from {supplier.name} yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white">
          {rows.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-ink">
                  {c.name}
                  <span className="ml-1.5 font-normal text-ink-muted">{c.code}</span>
                </div>
                <div className="truncate text-[12px] font-semibold text-ink-light">
                  {[c.category, c.unit].filter(Boolean).join(" · ")} ·{" "}
                  {qtyLabel(c.currentStock)} {c.unit} on hand
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[13px] font-bold text-ink">
                  {c.lastPurchaseCost == null ? "—" : money(c.lastPurchaseCost)}
                </div>
                <div className="text-[11.5px] font-semibold text-ink-light">
                  {c.lastPurchaseDate ?? "Never purchased"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
