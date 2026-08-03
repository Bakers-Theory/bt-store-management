"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { accountLabel, fundsShortfall } from "@/lib/cashbook";
import { rpcTransferCash } from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { CashAccount } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

export function CashTransferModal({
  balances,
  onClose,
  onSaved,
}: {
  /** Live cash and bank balances; only the sending side is checked. */
  balances: { cash: number; bank: number } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  const [fromAccount, setFromAccount] = useState<CashAccount>("cash");
  const [onDate, setOnDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const value = Number(amount);
  const to: CashAccount = fromAccount === "cash" ? "bank" : "cash";
  // The receiving leg can only raise the other account, so only the sending
  // side is checked — the same rule transfer_cash() applies in 0059.
  const shortfall = balances
    ? fundsShortfall(fromAccount, balances[fromAccount], value)
    : null;
  const valid =
    value > 0 && note.trim() !== "" && onDate !== "" && onDate <= today && !shortfall;

  const submit = () => {
    if (!valid || saving) return;
    setSaving(true);
    rpcTransferCash({ onDate, fromAccount, amount: value, note: note.trim() })
      .then(() => {
        toast(
          `Moved ${currency}${value.toLocaleString("en-IN")} to ${accountLabel(to)}`,
          "success",
        );
        onSaved();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setSaving(false));
  };

  return (
    <Modal title="Move money" onClose={onClose}>
      <div className="space-y-3.5">
        <div>
          <span className={labelCls}>From</span>
          <div className="grid grid-cols-2 gap-2">
            {(["cash", "bank"] as CashAccount[]).map((a) => (
              <button
                key={a}
                onClick={() => setFromAccount(a)}
                className={`rounded-[11px] border px-3 py-2.5 text-xs font-bold ${
                  fromAccount === a
                    ? "border-brown bg-brown text-white"
                    : "border-line bg-warm-white text-ink"
                }`}
              >
                {accountLabel(a)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
            {accountLabel(fromAccount)} <ArrowRight size={11} /> {accountLabel(to)}
            {balances && (
              <span>
                — {currency}
                {balances[fromAccount].toLocaleString("en-IN")} available
              </span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls} htmlFor="tx-date">Date</label>
            <input
              id="tx-date"
              type="date"
              max={today}
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="tx-amount">Amount ({currency})</label>
            <input
              id="tx-amount"
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
          <label className={labelCls} htmlFor="tx-note">What is this for?</label>
          <input
            id="tx-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Daily bank deposit"
            className={inputCls}
          />
        </div>

        {shortfall && (
          <p className="rounded-[11px] bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">
            {shortfall}
          </p>
        )}

        <button
          disabled={!valid || saving}
          onClick={submit}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          Move money
        </button>
      </div>
    </Modal>
  );
}
