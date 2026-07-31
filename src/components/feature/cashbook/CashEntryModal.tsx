"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import {
  ENTRY_MODES,
  accountLabel,
  modeToAccount,
  postableCategories,
} from "@/lib/cashbook";
import { rpcAddCashEntry, rpcUpdateCashEntry } from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { CashCategory, CashDirection, CashEntry, CashPaymentMode } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

export function CashEntryModal({
  entry,
  categories,
  onClose,
  onSaved,
}: {
  entry: CashEntry | null;
  categories: CashCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  // Direction is fixed once an entry exists: flipping it would turn an expense
  // into income on the same audit row. Delete and re-record instead.
  const [direction, setDirection] = useState<CashDirection>(entry?.direction ?? "out");
  const [onDate, setOnDate] = useState(entry?.onDate ?? today);
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [mode, setMode] = useState<CashPaymentMode>(
    entry && ENTRY_MODES.includes(entry.paymentMode) ? entry.paymentMode : "Cash",
  );
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [referenceNo, setReferenceNo] = useState(entry?.referenceNo ?? "");
  const [saving, setSaving] = useState(false);

  // Only leaves are postable, and only categories that flow the chosen way.
  // A childless top-level category is a leaf too, so `flat` must be offered
  // alongside the grouped ones — `post_cash` accepts it either way.
  const { groups, flat } = useMemo(
    () => postableCategories(categories, direction),
    [categories, direction],
  );

  const value = Number(amount);
  const valid =
    value > 0 && !!categoryId && note.trim() !== "" && onDate !== "" && onDate <= today;

  const submit = () => {
    if (!valid || saving) return;
    setSaving(true);
    const payload = {
      onDate,
      amount: value,
      mode,
      categoryId,
      note: note.trim(),
      referenceNo: referenceNo.trim(),
    };
    const run = entry
      ? rpcUpdateCashEntry(entry.id, payload)
      : rpcAddCashEntry({ ...payload, direction });
    Promise.resolve(run)
      .then(() => {
        toast(entry ? "Entry updated" : "Entry recorded", "success");
        onSaved();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setSaving(false));
  };

  return (
    <Modal title={entry ? "Edit entry" : "Add cashbook entry"} onClose={onClose}>
      <div className="space-y-3.5">
        {!entry && (
          <div>
            <span className={labelCls}>Which way did the money go?</span>
            <div className="grid grid-cols-2 gap-2">
              {(["out", "in"] as CashDirection[]).map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDirection(d);
                    setCategoryId(""); // the category list changes with direction
                  }}
                  className={`rounded-[11px] border px-3 py-2.5 text-xs font-bold ${
                    direction === d
                      ? "border-brown bg-brown text-white"
                      : "border-line bg-warm-white text-ink"
                  }`}
                >
                  {d === "out" ? "Money out" : "Money in"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls} htmlFor="cb-date">Date</label>
            <input
              id="cb-date"
              type="date"
              max={today}
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="cb-amount">Amount ({currency})</label>
            <input
              id="cb-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="cb-mode">Paid by</label>
          <select
            id="cb-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as CashPaymentMode)}
            className={inputCls}
          >
            {ENTRY_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {/* The mirror of mode_to_account(), used to tell the operator which
              balance is about to move. The SQL copy is what actually decides. */}
          <p className="mt-1 text-[11px] text-ink-muted">
            This will move <strong>{accountLabel(modeToAccount(mode))}</strong>.
          </p>
        </div>

        <div>
          <label className={labelCls} htmlFor="cb-category">Category</label>
          <select
            id="cb-category"
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
        </div>

        <div>
          <label className={labelCls} htmlFor="cb-note">What is this for?</label>
          <input
            id="cb-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="July rent paid to landlord"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="cb-ref">Reference number (optional)</label>
          <input
            id="cb-ref"
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
            className={inputCls}
          />
        </div>

        <button
          disabled={!valid || saving}
          onClick={submit}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {entry ? "Save changes" : "Record entry"}
        </button>
      </div>
    </Modal>
  );
}
