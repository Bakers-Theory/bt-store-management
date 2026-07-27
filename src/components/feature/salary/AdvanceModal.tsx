"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { canRequestAdvance } from "@/lib/advance";
import { round2 } from "@/lib/salary";
import type { AdvanceBalance } from "@/lib/types";

/**
 * Record an advance request.
 *
 * The cap is shown and checked here as well as in SQL — SQL is the authority,
 * but being told the headroom before submitting beats being refused after.
 */
export function AdvanceModal({
  employee,
  currency,
  onClose,
  onDone,
}: {
  employee: AdvanceBalance;
  currency: string;
  onClose: () => void;
  onDone: (amount: number, note: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const parsed = round2(parseFloat(amount) || 0);
  const check = canRequestAdvance(
    employee.balance,
    employee.pendingAmount,
    employee.monthlySalary,
    parsed,
  );
  const money = (n: number) => `${currency}${n.toFixed(2)}`;

  return (
    <Modal title={`Advance for ${employee.employeeName}`} onClose={onClose}>
      <div className="mb-3.5 grid grid-cols-3 gap-2 rounded-[11px] bg-cream p-2.5 text-center">
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Monthly salary</div>
          <div className="num text-[13px] font-bold">{money(employee.monthlySalary)}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Outstanding</div>
          <div className="num text-[13px] font-bold">{money(employee.balance)}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-semibold text-ink-muted">Awaiting approval</div>
          <div className="num text-[13px] font-bold">{money(employee.pendingAmount)}</div>
        </div>
      </div>

      <div className="mb-3.5">
        <label htmlFor="adv-amount" className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">
          Amount ({currency}) *
        </label>
        <input
          id="adv-amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={amount}
          placeholder="0.00"
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown"
        />
      </div>

      <div className="mb-3.5">
        <label htmlFor="adv-note" className="mb-[5px] block text-xs font-bold text-[#8a6a3c]">
          Reason (optional)
        </label>
        <input
          id="adv-note"
          type="text"
          value={note}
          placeholder="e.g. medical, festival, family emergency"
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown"
        />
      </div>

      {parsed > 0 && !check.ok && (
        <p className="mb-3.5 rounded-[11px] bg-danger-bg p-2.5 text-[12px] font-semibold text-danger">
          {check.reason}
        </p>
      )}

      <button
        type="button"
        onClick={() => onDone(parsed, note.trim())}
        disabled={!check.ok}
        className="w-full rounded-xl bg-brown p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Record request
      </button>

      <p className="mt-3 text-center text-[11.5px] text-ink-light">
        Advances are capped at one month&apos;s salary, counting anything already
        outstanding or awaiting approval. The request needs approving before the
        money is handed over.
      </p>
    </Modal>
  );
}
