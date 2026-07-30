"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Wallet, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { fetchSupplierSummaries } from "@/lib/supabase-data";
import { balanceRows, summaryTotals } from "@/lib/purchase";
import { SupplierAccountBreakdown } from "@/components/feature/suppliers/SupplierAccountBreakdown";
import { Skeleton } from "@/components/ui/Skeleton";
import type { SupplierSummary } from "@/lib/types";

// Matches the filter select on All records, so the two read tabs look alike.
const selectCls =
  "min-w-0 flex-1 rounded-xl border border-line bg-warm-white px-1.5 py-[11px] text-[12px] font-semibold text-ink-muted focus:border-brown sm:!w-auto sm:shrink-0 sm:flex-none sm:px-3 sm:text-[13.5px]";

export function SupplierBalances() {
  const currency = useBakeryStore((s) => s.bakery.currency);

  const [rows, setRows] = useState<SupplierSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [token, setToken] = useState(0);

  const [search, setSearch] = useState("");
  const [owingOnly, setOwingOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchSupplierSummaries()
      .then((data) => alive && (setRows(data), setLoaded(true)))
      .catch(() => alive && (setLoaded(true), setError(true)));
    return () => {
      alive = false;
    };
  }, [token]);

  const totals = useMemo(() => summaryTotals(rows), [rows]);
  const visible = useMemo(
    () => balanceRows(rows, { search, owingOnly }),
    [rows, search, owingOnly],
  );

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  // Three states, deliberately worded differently: a debt is a number to act
  // on, zero is a state rather than an amount, and a negative balance reads as
  // credit instead of as a stray minus sign.
  const amount = (n: number) =>
    n > 0
      ? { text: money(n), cls: "text-ink" }
      : n < 0
        ? { text: `in credit ${money(-n)}`, cls: "text-success" }
        : { text: "Settled", cls: "text-ink-light" };

  if (!loaded) return <Skeleton className="h-64 w-full rounded-[18px]" />;

  if (error) {
    return (
      <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-sm text-ink-muted">
        Couldn&apos;t load supplier balances.{" "}
        <button type="button" className="font-bold text-brown underline" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ["Outstanding", money(totals.outstanding)],
          ["Suppliers owing", String(totals.suppliersOwing)],
          ["Purchases", money(totals.purchases)],
          ["Payments", money(totals.payments)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[14px] border border-line bg-warm-white p-3 text-center">
            <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
            <div className="num mt-1 text-[15px] font-extrabold text-ink">{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-[200px] sm:flex-1">
          <span className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-ink-light">
            <Search size={16} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier or code…"
            className="w-full rounded-xl border border-line bg-warm-white py-[11px] pl-[38px] pr-10 text-sm outline-none"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-light hover:bg-cream hover:text-ink-muted"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <select
          aria-label="Balance filter"
          className={selectCls}
          value={owingOnly ? "owing" : "all"}
          onChange={(e) => setOwingOnly(e.target.value === "owing")}
        >
          <option value="all">All suppliers</option>
          <option value="owing">Owing only</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-warm-white px-5 py-[60px] text-center text-ink-muted">
          <div className="mb-3 flex justify-center">
            <Wallet size={44} />
          </div>
          <p className="text-sm">
            {owingOnly && !search.trim()
              ? "Nothing outstanding — every supplier is settled."
              : "No suppliers match your filters."}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] font-semibold text-ink-muted">
            {visible.length} supplier{visible.length === 1 ? "" : "s"}
          </p>
          <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
            {visible.map((r) => {
              const isOpen = openId === r.supplierId;
              const shown = amount(r.outstanding);
              return (
                <div key={r.supplierId} className="border-t border-line-soft first:border-t-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : r.supplierId)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-cream/60"
                  >
                    <span className="shrink-0 text-ink-light">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-ink">
                        {r.supplierName} ({r.supplierCode})
                      </div>
                      <div className="truncate text-[12px] font-semibold text-ink-light">
                        {r.lastTransactionDate
                          ? `last transaction ${r.lastTransactionDate}`
                          : "no activity yet"}
                      </div>
                    </div>
                    <div className={`shrink-0 text-right text-[13.5px] font-bold ${shown.cls}`}>
                      {shown.text}
                    </div>
                  </button>

                  {/* The row already carries every figure the breakdown shows,
                      so expanding costs no round trip. */}
                  {isOpen && (
                    <div className="border-t border-line-soft bg-cream/40 px-4 py-3">
                      <SupplierAccountBreakdown summary={r} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {totals.inHouseValue > 0 && (
        <p className="mt-3 text-[11.5px] text-ink-muted">
          In-house production value {money(totals.inHouseValue)}, reported separately —
          it carries cost but is never a payable, so it is not listed above.
        </p>
      )}
      <p className="mt-1.5 text-[11.5px] text-ink-muted">
        Every figure is computed from posted invoices, payments and returns — nothing
        here is stored, so it cannot fall out of step with the ledger.
      </p>
    </>
  );
}
