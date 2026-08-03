"use client";

import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { entryTypeLabel } from "@/lib/cashbook";
import type { CashEntry } from "@/lib/types";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * `on_date` is a date, not an instant. Do NOT use `formatDate` from lib/format —
 * it goes through `new Date("2026-07-31")`, which Postgres-style date strings
 * parse as UTC midnight, rendering the previous day in any negative-offset
 * timezone. Formatting the parts directly cannot drift.
 */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dayLabel = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};

export function CashbookTable({
  entries,
  canEdit,
  currentUserId,
  onEdit,
  onDelete,
}: {
  entries: CashEntry[];
  canEdit: boolean;
  currentUserId: string;
  onEdit: (e: CashEntry) => void;
  onDelete: (e: CashEntry) => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;
  // The trash icon arms an in-row confirm instead of a browser dialog.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center">
        <p className="text-sm font-semibold text-ink">No transactions</p>
        <p className="mt-1 text-xs text-ink-muted">
          Nothing matches these filters yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="text-[11px] font-bold uppercase tracking-wide text-[#8a6a3c]">
          <tr className="border-b border-line-soft">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Details</th>
            <th className="px-4 py-3">Mode</th>
            <th className="px-4 py-3">By</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3 text-right">Balance</th>
            <th className="w-[136px] px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            // A manual row is editable by the person who recorded it. The RPC
            // re-checks both facts; this only decides what to render.
            const mine = e.sourceType === "manual" && e.createdById === currentUserId;
            return (
              <tr
                key={e.id}
                className={`border-b border-line-soft last:border-0 ${
                  e.status === "reversed" ? "opacity-55" : ""
                }`}
              >
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="font-semibold text-ink">{dayLabel(e.onDate)}</span>
                  <span className="ml-1.5 text-ink-muted">{time(e.createdAt)}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink">
                  {entryTypeLabel(e)}
                  {e.status === "reversed" && (
                    <span className="ml-1.5 rounded bg-[#f3e6d2] px-1.5 py-0.5 text-[10px] font-bold text-[#8a6a3c]">
                      reversed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-muted">{e.categoryPath}</td>
                <td className="max-w-[220px] px-4 py-3 text-ink-muted">
                  <span className="block truncate">{e.note || e.sourceRef}</span>
                  {e.referenceNo && (
                    <span className="block truncate text-[11px]">
                      Ref {e.referenceNo}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                  {e.paymentMode}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                  {e.createdByName}
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums ${
                    e.direction === "in" ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {e.direction === "in" ? "+" : "−"}
                  {money(e.amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-muted">
                  {money(e.runningBalance)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {/* Armed state: a filled red "Remove" is the confirmation,
                      with an X to back out. Both states sit in the same
                      fixed-width, right-aligned box (matching the <th>), so
                      arming a row cannot resize the column and shift the
                      other columns left. */}
                  {canEdit && mine && confirmId === e.id && (
                    <span className="inline-flex w-[104px] items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          setConfirmId(null);
                          onDelete(e);
                        }}
                        className="rounded-lg bg-danger px-2 py-1 text-[11px] font-bold text-warm-white"
                      >
                        Remove
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        aria-label="Keep entry"
                        className="rounded-lg p-1.5 text-ink-muted hover:bg-[#f6ecdd]"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  )}
                  {canEdit && mine && confirmId !== e.id && (
                    <span className="inline-flex w-[104px] justify-end gap-1">
                      <button
                        onClick={() => onEdit(e)}
                        aria-label="Edit entry"
                        className="rounded-lg p-1.5 text-[#8a6a3c] hover:bg-[#f6ecdd]"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setConfirmId(e.id)}
                        aria-label="Remove entry"
                        className="rounded-lg p-1.5 text-red-700 hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
