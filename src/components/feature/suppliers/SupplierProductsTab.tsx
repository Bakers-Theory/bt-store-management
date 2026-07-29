"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2, Plus, X } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import {
  fetchSupplierProducts,
  rpcLinkSupplierItem,
  rpcUnlinkSupplierItem,
} from "@/lib/supabase-data";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Supplier, SupplierProduct } from "@/lib/types";

export function SupplierProductsTab({ supplier }: { supplier: Supplier }) {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const items = useBakeryStore((s) => s.items);
  const canEdit = hasPermission(user, "suppliers.edit");
  const canCost = hasPermission(user, "suppliers.financial");

  const [rows, setRows] = useState<SupplierProduct[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState(0);
  const [picking, setPicking] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    fetchSupplierProducts(supplier.id)
      .then((r) => alive && (setRows(r), setLoaded(true)))
      .catch(() => alive && (setLoaded(true), toast("Couldn't load products", "error")));
    return () => {
      alive = false;
    };
  }, [supplier.id, token, toast]);

  // Only offer what isn't already linked — re-linking is a no-op server-side,
  // but offering it reads as a bug.
  const linkable = useMemo(() => {
    const linked = new Set(rows.map((r) => r.itemId));
    return items.filter((i) => !linked.has(i.id));
  }, [items, rows]);

  const link = async () => {
    if (!picking) return;
    setBusy(true);
    try {
      await rpcLinkSupplierItem(supplier.id, picking);
      setPicking("");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't link that product", "error");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (row: SupplierProduct) => {
    setBusy(true);
    try {
      await rpcUnlinkSupplierItem(supplier.id, row.itemId);
      toast(`Unlinked ${row.itemName} — past purchases are unaffected`, "success");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't unlink that product", "error");
    } finally {
      setBusy(false);
    }
  };

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  if (!loaded) return <Skeleton className="h-40 w-full rounded-[18px]" />;

  return (
    <>
      {canEdit && supplier.status === "active" && (
        <div className="mb-3.5 flex gap-2">
          <select
            aria-label="Product to link"
            className="min-w-0 flex-1 rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown"
            value={picking}
            onChange={(e) => setPicking(e.target.value)}
          >
            <option value="">Add a product…</option>
            {linkable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.emoji || "📦"} {i.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={link}
            disabled={busy || !picking}
            className="inline-flex items-center gap-1.5 rounded-xl border-none bg-brown px-4 py-2.5 text-sm font-bold text-warm-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Link
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-ink-muted">
          <div className="mb-2.5 flex justify-center"><Link2 size={36} /></div>
          <p className="text-sm">No products linked to {supplier.name} yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white">
          {rows.map((r) => (
            <div
              key={r.itemId}
              className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0"
            >
              <ItemThumb src={r.imageUrl} emoji={r.emoji} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-ink">{r.itemName}</div>
                <div className="truncate text-[12px] font-semibold text-ink-light">
                  {[r.category, r.unit].filter(Boolean).join(" · ")} · {r.currentQty} in stock
                </div>
              </div>
              <div className="shrink-0 text-right">
                {canCost && (
                  <div className="text-[13px] font-bold text-ink">
                    {r.lastUnitCost == null ? "—" : money(r.lastUnitCost)}
                  </div>
                )}
                <div className="text-[11.5px] font-semibold text-ink-light">
                  {r.lastPurchaseDate ?? "Never purchased"}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Unlink ${r.itemName}`}
                  onClick={() => unlink(r)}
                  disabled={busy}
                  className="shrink-0 rounded-full p-1.5 text-ink-light disabled:opacity-60"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
