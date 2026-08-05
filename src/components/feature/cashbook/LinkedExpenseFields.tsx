"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { postableCategories } from "@/lib/cashbook";
import {
  LINKED_EXPENSE_MODES,
  linkedExpenseSummary,
  type LinkedExpenseDraft,
} from "@/lib/linked-expense";
import { fetchCashCategories, fetchSuppliers } from "@/lib/supabase-data";
import { round2 } from "@/lib/salary";
import type { CashCategory, LinkedExpenseMode, Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

/**
 * The cash book half of a purchase form (migration 0066), shared by the three
 * places money leaves for something the store now owns: receiving consumable
 * stock, registering an asset, and paying a repair bill.
 *
 * It never asks for the amount. The server derives that from the record being
 * saved — quantity × unit cost, the purchase price, the repair cost — so the
 * expense cannot end up saying something different from the thing it came from.
 * `amount` here is display and validation only.
 *
 * Recording the spend needs `expense.create` on top of the module permission,
 * and marking it paid needs `expense.pay`. Without the first the block is off
 * and locked, because receiving stock must not depend on the cash book keys.
 */
export function LinkedExpenseFields({
  draft,
  onChange,
  amount,
  today,
  error,
  vendorSuffix,
}: {
  draft: LinkedExpenseDraft;
  onChange: (next: LinkedExpenseDraft) => void;
  /** What the spend will be, computed by the host from what it is saving. */
  amount: number;
  today: string;
  /** The host's own validation message for this block, shown at the bottom. */
  error?: string | null;
  /** A word for what is being bought, for the empty-category hint. */
  vendorSuffix?: string;
}) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const canRecord = hasPermission(user, "expense.create");
  const canPay = hasPermission(user, "expense.pay");

  const [categories, setCategories] = useState<CashCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    // Optional enrichment on both counts: a failed list must not block the save,
    // and the server re-validates whatever is chosen.
    fetchCashCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  const { groups, flat } = useMemo(
    () => postableCategories(categories, "out"),
    [categories],
  );

  const set = (patch: Partial<LinkedExpenseDraft>) => onChange({ ...draft, ...patch });
  const money = round2(amount);

  return (
    <div className="rounded-[13px] border border-line bg-[#faf4ea] p-3">
      <label className="flex items-start gap-2 text-xs font-bold text-[#8a6a3c]">
        <input
          type="checkbox"
          checked={draft.record}
          disabled={!canRecord}
          onChange={(e) => set({ record: e.target.checked })}
          className="mt-px h-4 w-4 shrink-0 accent-brown"
        />
        <span>
          Record this in the cash book
          <span className="mt-0.5 block font-normal text-ink-muted">
            {canRecord
              ? "Files an expense against this, so the spend shows in Expenses and the cash book."
              : "You can record what arrived, but not what it cost. Someone with the expense permission can file it."}
          </span>
        </span>
      </label>

      {draft.record && canRecord && (
        <div className="mt-3 space-y-2.5 border-t border-line pt-3">
          <div>
            <label className={labelCls} htmlFor="le-cat">
              Cash book category
            </label>
            <select
              id="le-cat"
              value={draft.categoryId}
              onChange={(e) => set({ categoryId: e.target.value })}
              className={inputCls}
            >
              <option value="">Choose a category</option>
              {flat.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.leaves.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {vendorSuffix && draft.categoryId === "" && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Where {vendorSuffix} belongs in the cash book.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0">
              <label className={labelCls} htmlFor="le-mode">
                Paid by
              </label>
              <select
                id="le-mode"
                value={draft.paymentMode}
                onChange={(e) =>
                  set({ paymentMode: e.target.value as LinkedExpenseMode })
                }
                className={inputCls}
              >
                {LINKED_EXPENSE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {draft.pay && (
              <div className="min-w-0">
                <label className={labelCls} htmlFor="le-paid-on">
                  Paid on
                </label>
                <input
                  id="le-paid-on"
                  type="date"
                  max={today}
                  value={draft.paidOn}
                  onChange={(e) => set({ paidOn: e.target.value })}
                  className={inputCls}
                />
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 text-xs font-bold text-[#8a6a3c]">
            <input
              type="checkbox"
              checked={draft.pay}
              disabled={!canPay}
              onChange={(e) => set({ pay: e.target.checked })}
              className="mt-px h-4 w-4 shrink-0 accent-brown"
            />
            <span>
              This has been paid
              <span className="mt-0.5 block font-normal text-ink-muted">
                {canPay
                  ? "The money leaves the cash book now. Leave it off to send the expense for approval instead."
                  : "You cannot approve payments, so this expense will wait for someone who can."}
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0">
              <label className={labelCls} htmlFor="le-vendor">
                Vendor name (optional)
              </label>
              <input
                id="le-vendor"
                value={draft.vendorName}
                onChange={(e) => set({ vendorName: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="min-w-0">
              <label className={labelCls} htmlFor="le-inv">
                Invoice no. (optional)
              </label>
              <input
                id="le-inv"
                value={draft.invoiceNo}
                onChange={(e) => set({ invoiceNo: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="le-supplier">
              Link to a supplier (optional)
            </label>
            <select
              id="le-supplier"
              value={draft.vendorSupplierId}
              onChange={(e) => set({ vendorSupplierId: e.target.value })}
              className={inputCls}
            >
              <option value="">Not a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {draft.vendorSupplierId && (
              <p className="mt-1.5 flex gap-1.5 text-[11px] text-ink-muted">
                <Info size={13} className="mt-px shrink-0" />
                <span>
                  This <strong>does not</strong> reduce what you owe them. To pay an
                  invoice, use <strong>Purchases → Payments</strong>.
                </span>
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-bold text-[#8a6a3c]">
              <input
                type="checkbox"
                checked={draft.gstIncluded}
                onChange={(e) => set({ gstIncluded: e.target.checked })}
                className="h-4 w-4 shrink-0 accent-brown"
              />
              GST is included in the cost
            </label>
            {draft.gstIncluded && (
              <input
                aria-label={`GST amount (${currency})`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={draft.gstAmount}
                onChange={(e) => set({ gstAmount: e.target.value })}
                placeholder={`GST inside the ${currency}${money.toLocaleString("en-IN")}`}
                className={`${inputCls} mt-2`}
              />
            )}
          </div>

          <p className="rounded-[10px] bg-warm-white px-2.5 py-2 text-[11px] text-ink">
            {money > 0
              ? linkedExpenseSummary(draft, money, currency)
              : "Enter the cost above and this will show what leaves the cash book."}
          </p>

          {error && (
            <p className="text-[11px] font-semibold text-red-700">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
