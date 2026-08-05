"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2,Settings2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CategoryManager } from "@/components/feature/cashbook/CategoryManager";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { accountLabel, modeToAccount, postableCategories } from "@/lib/cashbook";
import {
  BANK_SPLIT_MODES,
  EXPENSE_MODES,
  gstSplit,
  isDuplicateInvoice,
  splitError,
} from "@/lib/expense";
import {
  fetchInvoiceNosLike,
  fetchSuppliers,
  rpcSaveExpense,
} from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type {
  CashCategory,
  Expense,
  ExpenseBankMode,
  ExpenseMode,
  Supplier,
} from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

export function ExpenseForm({
  expense,
  categories,
  onCategoriesChanged,
  vendors,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  categories: CashCategory[];
  onCategoriesChanged: () => void;
  vendors: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const canPay = hasPermission(user, "expense.pay");
  const today = isoDateLocal(new Date());
  const canManageCategories = hasPermission(user, "expense.create");
  
  const [managingCategories, setManagingCategories] = useState(false);
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? today);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  const [vendorName, setVendorName] = useState(expense?.vendorName ?? "");
  const [supplierId, setSupplierId] = useState(expense?.vendorSupplierId ?? "");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [gstIncluded, setGstIncluded] = useState(expense?.gstIncluded ?? false);
  const [gstAmount, setGstAmount] = useState(expense ? String(expense.gstAmount) : "");
  const [mode, setMode] = useState<ExpenseMode>(expense?.paymentMode ?? "Cash");
  const [splitCash, setSplitCash] = useState(expense ? String(expense.splitCash) : "");
  const [splitBank, setSplitBank] = useState(expense ? String(expense.splitBank) : "");
  const [bankMode, setBankMode] = useState<ExpenseBankMode>(
    expense?.splitBankMode || "UPI",
  );
  const [invoiceNo, setInvoiceNo] = useState(expense?.invoiceNo ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [dupWarning, setDupWarning] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Optional enrichment: a failed supplier list must not block the form.
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  const value = Number(amount);
  const gst = gstIncluded ? Number(gstAmount || 0) : 0;
  const { base } = gstSplit(value || 0, gstIncluded, gst);
  const mixedError =
    mode === "Mixed"
      ? splitError(value || 0, Number(splitCash || 0), Number(splitBank || 0))
      : null;

  // Only money-out categories are ever filed against. Childless top-level
  // categories are leaves too, so they are offered alongside the grouped ones
  // (see postableCategories).
  const { groups, flat } = useMemo(
    () => postableCategories(categories, "out"),
    [categories],
  );

  /** A warning, not a block (#32). Checked on blur, not per keystroke. */
  const checkInvoice = () => {
    const trimmed = invoiceNo.trim();
    if (trimmed === "") {
      setDupWarning(false);
      return;
    }
    fetchInvoiceNosLike(trimmed, expense?.id)
      .then((existing) => setDupWarning(isDuplicateInvoice(trimmed, existing)))
      .catch(() => setDupWarning(false));
  };

  const amountLocked = !!expense && expense.originType !== "";
  const gstValid = !gstIncluded || (gst >= 0 && gst < value);
  const valid =
    value > 0 &&
    !!categoryId &&
    expenseDate !== "" &&
    expenseDate <= today &&
    gstValid &&
    mixedError === null;

  const submit = (payNow: boolean) => {
    if (!valid || saving) return;
    setSaving(true);
    rpcSaveExpense(
      {
        id: expense?.id,
        expenseDate,
        categoryId,
        vendorName: vendorName.trim(),
        vendorSupplierId: supplierId || null,
        amount: value,
        gstIncluded,
        gstAmount: gst,
        paymentMode: mode,
        splitCash: mode === "Mixed" ? Number(splitCash) : 0,
        splitBank: mode === "Mixed" ? Number(splitBank) : 0,
        splitBankMode: mode === "Mixed" ? bankMode : "",
        invoiceNo: invoiceNo.trim(),
        description: description.trim(),
        paidById: "",
      },
      payNow,
    )
      .then(() => {
        toast(
          expense
            ? "Expense updated"
            : payNow
              ? "Expense recorded and paid"
              : "Expense sent for approval",
          "success",
        );
        onSaved();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      title={expense ? `Edit expense #${expense.expenseNo}` : "Add expense"}
      onClose={onClose}
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="ex-date">Date of expense</label>
            <input
              id="ex-date"
              type="date"
              max={today}
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="ex-amount">Total ({currency})</label>
            <input
              id="ex-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              // 0066: an expense created from a stock movement, an asset or a
              // repair mirrors that record's cost. The server refuses a change,
              // so the field says so rather than letting it be typed and bounced.
              readOnly={amountLocked}
              className={`${inputCls}${amountLocked ? " text-ink-muted" : ""}`}
            />
            {amountLocked && (
              <p className="mt-1 text-[11px] text-ink-muted">
                From {expense?.originRef || "the record this came from"} — change it
                there.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={labelCls.replace("mb-1.5 ", "")} htmlFor="ex-cat">
              Category
            </label>
            {canManageCategories && (
              <button
                type="button"
                onClick={() => setManagingCategories((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-brown"
                aria-expanded={managingCategories}
              >
                <Settings2 size={12} />
                {managingCategories ? "Done" : "Manage"}
              </button>
            )}
          </div>
          <select
            id="ex-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
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
          {managingCategories && (
            <CategoryManager
              categories={categories}
              onChanged={onCategoriesChanged}
            />
          )}
        </div>

        <div>
          <label className={labelCls} htmlFor="ex-vendor">Vendor</label>
          <input
            id="ex-vendor"
            list="ex-vendor-list"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="Rent, Electricity Bill, etc..."
            className={inputCls}
          />
          {/* Autocomplete over past names, so 'BESCOM' and 'Bescom' don't drift
              into two vendors in the vendor-wise report. */}
          <datalist id="ex-vendor-list">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>

          <label className={`${labelCls} mt-2.5`} htmlFor="ex-supplier">
            Link to a supplier (optional)
          </label>
          <select
            id="ex-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={inputCls}
          >
            <option value="">Not a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {supplierId && (
            <p className="mt-1.5 flex gap-1.5 rounded-[10px] bg-[#f9f2e7] px-2.5 py-2 text-[11px] text-ink-muted">
              <Info size={13} className="mt-px shrink-0" />
              <span>
                This <strong>does not</strong> reduce what you owe this supplier. To
                pay an invoice, use <strong>Purchases → Payments</strong>.
              </span>
            </p>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-[#8a6a3c]">
            <input
              type="checkbox"
              checked={gstIncluded}
              onChange={(e) => setGstIncluded(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-brown"
            />
            GST is included in the total
          </label>
          {gstIncluded && (
            <div className="mt-2">
              <label className={labelCls} htmlFor="ex-gst">GST amount ({currency})</label>
              <input
                id="ex-gst"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={gstAmount}
                onChange={(e) => setGstAmount(e.target.value)}
                className={inputCls}
              />
              {/* Nothing to say either way until there is a total to compare
                  against — an empty amount is not yet a mistake. */}
              {value > 0 &&
                (gstValid ? (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Before GST: {currency}
                    {base.toLocaleString("en-IN")}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] font-semibold text-red-700">
                    The GST is inside the total, so it has to be less than it.
                  </p>
                ))}
            </div>
          )}
        </div>

        <div>
          <label className={labelCls} htmlFor="ex-mode">Paid by</label>
          <select
            id="ex-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as ExpenseMode)}
            className={inputCls}
          >
            {EXPENSE_MODES.map((m) => (
              <option key={m} value={m}>
                {m === "Mixed" ? "Mixed — part cash, part bank" : m}
              </option>
            ))}
          </select>
          {/* The mirror of mode_to_account(), used to tell the operator which
              balance is about to move. The SQL copy is what actually decides.
              Mixed is not a payment mode of its own — it posts one leg to each. */}
          <p className="mt-1 text-[11px] text-ink-muted">
            {mode === "Mixed" ? (
              <>
                This will move <strong>both {accountLabel("cash")}</strong> and{" "}
                <strong>{accountLabel("bank")}</strong>.
              </>
            ) : (
              <>
                This will move{" "}
                <strong>{accountLabel(modeToAccount(mode))}</strong>.
              </>
            )}
          </p>
        </div>

        {mode === "Mixed" && (
          <div className="space-y-2.5 rounded-[13px] border border-line bg-[#faf4ea] p-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="min-w-0">
                <label className={labelCls} htmlFor="ex-cash">Cash part ({currency})</label>
                <input
                  id="ex-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={splitCash}
                  onChange={(e) => setSplitCash(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="ex-bank">Bank part ({currency})</label>
                <input
                  id="ex-bank"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={splitBank}
                  onChange={(e) => setSplitBank(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="ex-bankmode">The bank part was</label>
              <select
                id="ex-bankmode"
                value={bankMode}
                onChange={(e) => setBankMode(e.target.value as ExpenseBankMode)}
                className={inputCls}
              >
                {BANK_SPLIT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {mixedError && (
              <p className="text-[11px] font-semibold text-red-700">{mixedError}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="ex-inv">
              Invoice number (optional)
            </label>
            <input
              id="ex-inv"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              onBlur={checkInvoice}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="ex-desc">Notes (optional)</label>
            <input
              id="ex-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {dupWarning && (
          <p className="flex gap-1.5 rounded-[10px] bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>
              An expense with invoice <strong>{invoiceNo.trim()}</strong> already
              exists. You can still save — split invoices are normal.
            </span>
          </p>
        )}

        {/* Two paths, one hop. An approver records it paid; everyone else sends
            it for approval. The RPC re-checks expense.pay either way. */}
        {expense ? (
          <button
            disabled={!valid || saving}
            onClick={() => submit(false)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Save changes
          </button>
        ) : canPay ? (
          <div className="space-y-2">
            <button
              disabled={!valid || saving}
              onClick={() => submit(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Record as paid
            </button>
            <button
              disabled={!valid || saving}
              onClick={() => submit(false)}
              className="w-full rounded-[13px] border border-line bg-warm-white py-2.5 text-xs font-bold text-ink disabled:opacity-50"
            >
              Save without paying
            </button>
          </div>
        ) : (
          <>
            <button
              disabled={!valid || saving}
              onClick={() => submit(false)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Send for approval
            </button>
            <p className="text-center text-[11px] text-ink-muted">
              A supervisor will approve and pay this.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
