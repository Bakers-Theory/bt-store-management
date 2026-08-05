"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import {
  MOVEMENT_TYPES,
  movementDirection,
  movementError,
  movementTypeLabel,
  reasonRequired,
  stockAfter,
} from "@/lib/consumable";
import {
  draftToInput,
  emptyLinkedExpense,
  linkedExpenseError,
} from "@/lib/linked-expense";
import { LinkedExpenseFields } from "@/components/feature/cashbook/LinkedExpenseFields";
import {
  fetchAssetHolders,
  fetchSuppliers,
  rpcRecordStockMovement,
} from "@/lib/supabase-data";
import { round2 } from "@/lib/salary";
import { isoDateLocal } from "@/lib/excel";
import { qtyLabel } from "./ConsumableList";
import type { Consumable, Employee, MovementType, Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

/** Which key each movement type needs — the mirror of 0063 note 3. */
const ADJUST_TYPES: MovementType[] = ["adjustment", "wastage", "expired", "damaged"];

/**
 * The one way consumable stock moves (§3.3). Two things this screen must get
 * right, because they are the ticket's actual requirements:
 *
 *  - it shows what the stock WILL be, so an operator can see the effect before
 *    committing;
 *  - it refuses to submit a movement that would take stock negative. The server
 *    blocks it too, under a row lock, so this is a courtesy rather than the guard.
 */
export function StockMovementModal({
  item,
  onClose,
  onDone,
}: {
  item: Consumable;
  onClose: () => void;
  onDone: () => void;
}) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  const canIssue = hasPermission(user, "consumables.issue");
  const canAdjust = hasPermission(user, "consumables.adjust");
  const allowed = MOVEMENT_TYPES.filter((t) =>
    ADJUST_TYPES.includes(t) ? canAdjust : canIssue,
  );

  const [movementType, setMovementType] = useState<MovementType>(allowed[0] ?? "issue");
  const [qty, setQty] = useState("");
  const [onDate, setOnDate] = useState(today);
  const [unitCost, setUnitCost] = useState(
    item.lastPurchaseCost !== null ? String(item.lastPurchaseCost) : "",
  );
  const [vendorId, setVendorId] = useState(item.vendorId ?? "");
  const [issuedTo, setIssuedTo] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [holders, setHolders] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  // The cash book side of a purchase (0066). Defaults follow the permissions:
  // whoever can record spending gets it on, whoever can pay gets it marked paid.
  const [spend, setSpend] = useState(() =>
    emptyLinkedExpense(today, {
      canRecord: hasPermission(user, "expense.create"),
      canPay: hasPermission(user, "expense.pay"),
    }),
  );

  useEffect(() => {
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
    // Only used to name who took the stock; a failure must not block the entry.
    fetchAssetHolders()
      .then(setHolders)
      .catch(() => setHolders([]));
  }, []);

  const value = qty === "" ? Number.NaN : Number(qty);
  const isPurchase = movementType === "purchase";
  const direction = movementDirection(movementType);

  const error =
    allowed.length === 0
      ? "You cannot record stock movements"
      : onDate > today
        ? "A stock movement cannot be dated in the future"
        : movementError(item.currentStock, movementType, value, reason, item.unit);

  const after = Number.isFinite(value)
    ? stockAfter(item.currentStock, movementType, value)
    : item.currentStock;

  // What the stock cost, and therefore what the expense will be. The server
  // computes the same figure from the movement it just wrote — this is only so
  // the operator can see it before committing.
  const cost =
    isPurchase && unitCost !== "" && Number.isFinite(value)
      ? round2(Number(unitCost) * Math.abs(value))
      : 0;
  // Offered only once there is a cost to post — a purchase may be recorded with
  // no price known, and there is nothing to file until there is one.
  const offerSpend = isPurchase && cost > 0;
  const spendError = offerSpend ? linkedExpenseError(spend, cost, today) : null;

  const submit = async () => {
    if (error || spendError) return;
    setSaving(true);
    try {
      const r = await rpcRecordStockMovement({
        consumableId: item.id,
        movementType,
        qty: value,
        onDate,
        unitCost: isPurchase && unitCost !== "" ? Number(unitCost) : null,
        vendorId: isPurchase ? vendorId || null : null,
        issuedTo: movementType === "issue" ? issuedTo || null : null,
        reason,
        remarks,
        // Purchases only — the server refuses a spend on anything else.
        expense: offerSpend ? draftToInput(spend) : null,
      });
      toast(
        `${movementTypeLabel(movementType)} recorded — ${qtyLabel(r.currentStock)} ${item.unit} on hand` +
          (r.expenseId ? `, and filed in the cash book` : ""),
        "success",
      );
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record the movement", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Stock — ${item.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-[11px] bg-cream px-3 py-2 text-xs text-ink">
          On hand now:{" "}
          <strong>
            {qtyLabel(item.currentStock)} {item.unit}
          </strong>
          <span className="text-ink-muted">
            {" · minimum "}
            {qtyLabel(item.minStock)} {item.unit}
          </span>
        </p>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="sm-type">What happened</label>
            <select
              id="sm-type"
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as MovementType)}
              className={inputCls}
            >
              {allowed.map((t) => (
                <option key={t} value={t}>
                  {movementTypeLabel(t)}
                  {movementDirection(t) === "in" ? " (in)" : ""}
                  {movementDirection(t) === "out" ? " (out)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="sm-qty">
              Quantity ({item.unit})
            </label>
            <input
              id="sm-qty"
              type="number"
              step="0.001"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              {direction === "either"
                ? "Negative to reduce, positive to add."
                : direction === "in"
                  ? "Always positive — the type says it comes in."
                  : "Always positive — the type says it goes out."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="sm-date">On</label>
            <input
              id="sm-date"
              type="date"
              max={today}
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={inputCls}
            />
          </div>
          {isPurchase && (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="sm-cost">
                Cost per {item.unit} ({currency})
              </label>
              <input
                id="sm-cost"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {movementType === "issue" && (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="sm-to">Issued to (optional)</label>
              <select
                id="sm-to"
                value={issuedTo}
                onChange={(e) => setIssuedTo(e.target.value)}
                className={inputCls}
              >
                <option value="">Not recorded</option>
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isPurchase && (
          <div>
            <label className={labelCls} htmlFor="sm-vendor">Bought from (optional)</label>
            <select
              id="sm-vendor"
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
        )}

        {reasonRequired(movementType) && (
          <div>
            <label className={labelCls} htmlFor="sm-reason">Why</label>
            <input
              id="sm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                movementType === "adjustment"
                  ? "e.g. Stock count correction"
                  : "e.g. Spoiled in storage"
              }
              className={inputCls}
            />
          </div>
        )}

        <div>
          <label className={labelCls} htmlFor="sm-rem">Remarks (optional)</label>
          <input
            id="sm-rem"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* The effect, before committing to it. */}
        {Number.isFinite(value) && !error && (
          <p className="rounded-[10px] bg-[#faf4ea] px-2.5 py-2 text-[11px] text-ink">
            After this: <strong>{qtyLabel(after)} {item.unit}</strong>
            {after < item.minStock && after > 0 && " — below the minimum"}
            {after === 0 && " — nothing left"}
          </p>
        )}

        {offerSpend && (
          <LinkedExpenseFields
            draft={spend}
            onChange={setSpend}
            amount={cost}
            today={today}
            error={spendError}
            vendorSuffix={item.name}
          />
        )}

        {error && qty !== "" && (
          <p className="text-[11px] font-semibold text-red-700">{error}</p>
        )}

        <button
          disabled={!!error || !!spendError || saving}
          onClick={() => void submit()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          Record {movementTypeLabel(movementType).toLowerCase()}
        </button>
        <p className="text-center text-[11px] text-ink-muted">
          Entries are never edited or deleted — a mistake is corrected with an
          adjustment.
        </p>
      </div>
    </Modal>
  );
}
