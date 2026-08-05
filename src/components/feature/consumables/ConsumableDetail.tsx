"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { movementTypeLabel, stockStatusLabel } from "@/lib/consumable";
import {
  fetchConsumable,
  fetchStockMovementsPage,
  rpcDeleteConsumable,
} from "@/lib/supabase-data";
import { StockMovementModal } from "./StockMovementModal";
import { qtyLabel } from "./ConsumableList";
import type { Consumable, StockMovement } from "@/lib/types";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const day = (ymd: string | null) => {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a6a3c]">
      {label}
    </p>
    <p className="truncate text-[13px] font-semibold text-ink">{value || "—"}</p>
  </div>
);

const LEDGER_PAGE = 20;

/**
 * One item: its levels, and the ledger that produced them. The running figure at
 * the top is `current_stock` from the view — the sum of the movements listed
 * below it, never a separately stored number.
 */
export function ConsumableDetail({
  itemId,
  onClose,
  onEdit,
  onChanged,
}: {
  itemId: string;
  onClose: () => void;
  onEdit: (c: Consumable) => void;
  onChanged: () => void;
}) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const requireOwnerAuth = useUIStore((s) => s.requireOwnerAuth);

  const [item, setItem] = useState<Consumable | null>(null);
  const [ledger, setLedger] = useState<StockMovement[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadLedger = useCallback(
    (offset: number) =>
      fetchStockMovementsPage(offset, LEDGER_PAGE, { consumableId: itemId })
        .then((page) => {
          setLedger((prev) =>
            offset === 0 ? page.movements : [...prev, ...page.movements],
          );
          setHasMore(page.hasMore);
        })
        .catch(() => toast("Couldn't load the stock movements", "error")),
    [itemId, toast],
  );

  const load = useCallback(() => {
    Promise.all([fetchConsumable(itemId), loadLedger(0)])
      .then(([c]) => setItem(c))
      .catch(() => toast("Couldn't load the item", "error"))
      .finally(() => setLoaded(true));
  }, [itemId, loadLedger, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const canIssue = hasPermission(user, "consumables.issue");
  const canAdjust = hasPermission(user, "consumables.adjust");
  const canEdit = hasPermission(user, "consumables.edit");
  const canDelete = hasPermission(user, "consumables.delete");

  const remove = () => {
    if (!item) return;
    requireOwnerAuth(`Remove ${item.code}`, async () => {
      setBusy(true);
      try {
        await rpcDeleteConsumable(item.id);
        toast("Item removed", "success");
        onChanged();
        onClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not remove the item", "error");
      } finally {
        setBusy(false);
      }
    });
  };

  if (!loaded) {
    return (
      <Modal title="Item" onClose={onClose}>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[12px]" />
          ))}
        </div>
      </Modal>
    );
  }

  if (!item) {
    return (
      <Modal title="Item" onClose={onClose}>
        <p className="py-6 text-center text-sm text-ink-muted">
          This item is no longer available.
        </p>
      </Modal>
    );
  }

  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  return (
    <>
      <Modal title={`${item.name} · ${item.code}`} onClose={onClose}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2 rounded-[14px] border border-line bg-warm-white px-3 py-2.5">
            <p className="text-2xl font-extrabold tabular-nums text-ink">
              {qtyLabel(item.currentStock)}
              <span className="ml-1 text-sm font-bold text-ink-muted">{item.unit}</span>
            </p>
            <span className="rounded bg-[#f3e6d2] px-2 py-0.5 text-[11px] font-bold text-[#8a6a3c]">
              {stockStatusLabel(item.stockStatus)}
            </span>
            <span className="text-[11px] text-ink-muted">
              worth {money(item.stockValue)}
            </span>
          </div>

          {item.recommendedQty > 0 && (
            <p className="rounded-[12px] bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              Suggested order: <strong>{qtyLabel(item.recommendedQty)} {item.unit}</strong>
              {item.vendorName && ` from ${item.vendorName}`}
            </p>
          )}

          {item.expiryDaysLeft !== null && item.expiryDaysLeft <= 30 && (
            <p className="rounded-[12px] bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              {item.expiryDaysLeft < 0
                ? `Expired ${Math.abs(item.expiryDaysLeft)} day(s) ago.`
                : `Expires in ${item.expiryDaysLeft} day(s).`}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2.5 rounded-[14px] border border-line bg-warm-white p-3 sm:grid-cols-3">
            <Row label="Category" value={item.category} />
            <Row label="Minimum" value={`${qtyLabel(item.minStock)} ${item.unit}`} />
            <Row
              label="Maximum"
              value={item.maxStock === null ? "" : `${qtyLabel(item.maxStock)} ${item.unit}`}
            />
            <Row
              label="Reorder at"
              value={
                item.reorderLevel === null
                  ? ""
                  : `${qtyLabel(item.reorderLevel)} ${item.unit}`
              }
            />
            <Row label="Kept at" value={item.storageLocation} />
            <Row label="Vendor" value={item.vendorName} />
            <Row label="Last bought" value={day(item.lastPurchaseDate)} />
            <Row
              label="Last cost"
              value={item.lastPurchaseCost === null ? "" : money(item.lastPurchaseCost)}
            />
            <Row label="Expires" value={day(item.expiryDate)} />
          </div>

          {item.notes && (
            <p className="rounded-[12px] bg-cream px-3 py-2 text-xs text-ink">{item.notes}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {(canIssue || canAdjust) && (
              <button
                onClick={() => setMoving(true)}
                className="inline-flex items-center gap-1.5 rounded-[11px] bg-brown px-3 py-2 text-xs font-bold text-white"
              >
                <Plus size={13} /> Record stock
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => onEdit(item)}
                className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-bold text-ink"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
            {canDelete && (
              <button
                disabled={busy}
                onClick={remove}
                className="inline-flex items-center gap-1.5 rounded-[11px] border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Remove
              </button>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-bold text-[#8a6a3c]">Stock movements</p>
            {ledger.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-muted">
                No movements yet — record a purchase to put stock on the shelf.
              </p>
            ) : (
              <div className="space-y-1">
                {ledger.map((m) => {
                  const inward = m.qtySigned > 0;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-[12px] border border-line bg-warm-white px-3 py-2"
                    >
                      {inward ? (
                        <ArrowDownRight size={14} className="shrink-0 text-green-700" />
                      ) : (
                        <ArrowUpRight size={14} className="shrink-0 text-red-700" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-bold text-ink">
                          {movementTypeLabel(m.movementType)}
                          {m.reason && (
                            <span className="ml-1.5 font-normal text-ink-muted">
                              {m.reason}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-ink-muted">
                          {day(m.onDate)}
                          {m.createdByName && ` · ${m.createdByName}`}
                          {m.issuedToName && ` · to ${m.issuedToName}`}
                          {m.vendorName && ` · ${m.vendorName}`}
                          {m.remarks && ` · ${m.remarks}`}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-right text-[12.5px] font-bold tabular-nums ${
                          inward ? "text-green-700" : "text-red-700"
                        }`}
                      >
                        {inward ? "+" : "−"}
                        {qtyLabel(Math.abs(m.qtySigned))}
                        {m.unitCost !== null && (
                          <span className="block text-[10.5px] font-normal text-ink-muted">
                            {money(m.movementValue)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {hasMore && (
                  <button
                    onClick={() => void loadLedger(ledger.length)}
                    className="w-full rounded-[11px] border border-line bg-warm-white py-2 text-xs font-bold text-ink"
                  >
                    Load more
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {moving && (
        <StockMovementModal
          item={item}
          onClose={() => setMoving(false)}
          onDone={() => {
            setMoving(false);
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}
