"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Receipt, Search, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { fetchPurchaseInvoice, fetchPurchaseInvoices } from "@/lib/supabase-data";
import { supplierTypeLabel } from "@/lib/supplier";
import { DateRangeFilter } from "@/components/ui/DateRangePicker";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DateRange } from "@/lib/date-range";
import type { InvoiceStatus, PurchaseInvoice, SupplierType } from "@/lib/types";

// `!w-auto` overrides the global `select { width: 100% }`, which would otherwise
// let each select eat the search field's space in this flex row.
const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

const STATUS_TONE: Record<InvoiceStatus, string> = {
  posted: "bg-success-bg text-success",
  draft: "bg-cream-dark text-ink-muted",
  cancelled: "bg-cream text-ink-light",
};

/**
 * Every purchase record in one place — both supplier types, all three statuses.
 *
 * Only headers are listed; a row's lines are fetched on expand, so opening the
 * tab costs one query rather than one per invoice.
 */
export function PurchaseRecords() {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const canFinancial = hasPermission(user, "suppliers.financial");

  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [rows, setRows] = useState<PurchaseInvoice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [token, setToken] = useState(0);

  const [search, setSearch] = useState("");
  const [type, setType] = useState<SupplierType | "all">("all");
  const [status, setStatus] = useState<InvoiceStatus | "all">("posted");

  // Lines, per invoice id, fetched the first time a row is opened.
  const [openId, setOpenId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, PurchaseInvoice>>({});
  const [loadingLines, setLoadingLines] = useState(false);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchPurchaseInvoices({ range })
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setLoaded(true);
        setError(true);
      });
    return () => {
      alive = false;
    };
  }, [range, token]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (type !== "all" && r.supplierType !== type) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return (
        r.supplierName.toLowerCase().includes(q) ||
        r.supplierCode.toLowerCase().includes(q) ||
        (r.invoiceNo ?? "").toLowerCase().includes(q) ||
        (r.internalRef ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, type, status]);

  // Only posted rows are money that actually counts, so only they are totalled.
  const total = useMemo(
    () => visible.filter((r) => r.status === "posted").reduce((s, r) => s + r.total, 0),
    [visible],
  );

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  const open = async (r: PurchaseInvoice) => {
    if (openId === r.id) {
      setOpenId(null);
      return;
    }
    setOpenId(r.id);
    if (lines[r.id]) return;
    setLoadingLines(true);
    try {
      const full = await fetchPurchaseInvoice(r.id);
      if (full) setLines((m) => ({ ...m, [r.id]: full }));
    } catch {
      toast("Couldn't load that invoice's lines", "error");
    } finally {
      setLoadingLines(false);
    }
  };

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <span className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-ink-light">
            <Search size={16} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, invoice or IH- reference…"
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
          aria-label="Supplier type"
          className={selectCls}
          value={type}
          onChange={(e) => setType(e.target.value as SupplierType | "all")}
        >
          <option value="all">All types</option>
          <option value="external">External</option>
          <option value="in_house">In-house</option>
        </select>
        <select
          aria-label="Status"
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as InvoiceStatus | "all")}
        >
          <option value="posted">Posted</option>
          <option value="draft">Draft</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All statuses</option>
        </select>
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {!loaded ? (
        <Skeleton className="h-48 w-full rounded-[18px]" />
      ) : error ? (
        <div className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-sm text-ink-muted">
          Couldn&apos;t load purchase records.{" "}
          <button type="button" className="font-bold text-brown underline" onClick={reload}>
            Retry
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-warm-white px-5 py-[60px] text-center text-ink-muted">
          <div className="mb-3 flex justify-center"><Receipt size={44} /></div>
          <p className="text-sm">
            {rows.length === 0
              ? "No purchases recorded in this period."
              : "No purchases match your filters."}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] font-semibold text-ink-muted">
            {visible.length} record{visible.length === 1 ? "" : "s"}
            {canFinancial ? ` · ${money(total)} posted` : ""}
          </p>
          <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
            {visible.map((r) => {
              const isOpen = openId === r.id;
              const full = lines[r.id];
              return (
                <div key={r.id} className="border-t border-line-soft first:border-t-0">
                  <button
                    type="button"
                    onClick={() => open(r)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-cream/60"
                  >
                    <span className="shrink-0 text-ink-light">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-ink">
                        {r.invoiceNo ?? r.internalRef ?? "—"} · {r.supplierName}
                      </div>
                      <div className="truncate text-[12px] font-semibold text-ink-light">
                        {r.purchaseDate} · {supplierTypeLabel(r.supplierType)}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </div>
                    </div>
                    {r.status !== "posted" && (
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_TONE[r.status]}`}
                      >
                        {r.status}
                      </span>
                    )}
                    {canFinancial && (
                      <div className="shrink-0 text-right">
                        <div className="text-[13.5px] font-bold text-ink">{money(r.total)}</div>
                        <div className="text-[11.5px] font-semibold text-ink-light">
                          {/* An in-house receipt has no GST at all, which is a
                              different fact from GST coming to nothing. */}
                          {r.gstAmount == null ? "no GST" : `incl. ${money(r.gstAmount)} GST`}
                        </div>
                      </div>
                    )}
                  </button>

                  {isOpen && (
                    <div className="border-t border-line-soft bg-cream/40 px-4 py-3">
                      {!full ? (
                        loadingLines ? (
                          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
                            <Loader2 size={14} className="animate-spin" /> Loading lines…
                          </div>
                        ) : (
                          <p className="text-[12.5px] font-semibold text-ink-muted">
                            Couldn&apos;t load the lines for this invoice.
                          </p>
                        )
                      ) : (
                        <>
                          {full.lines.map((l) => (
                            <div
                              key={l.id}
                              className="flex items-center gap-3 border-t border-line-soft py-2 first:border-t-0"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold text-ink">
                                  {l.itemName}
                                </div>
                                <div className="text-[11.5px] font-semibold text-ink-light">
                                  {l.qty}
                                  {canFinancial ? ` × ${money(l.unitCost)}` : ""}
                                  {l.gstRate > 0 ? ` · ${l.gstRate}% GST` : ""}
                                  {l.expiry ? ` · expires ${l.expiry}` : ""}
                                  {l.returnedQty > 0 ? ` · ${l.returnedQty} returned` : ""}
                                </div>
                              </div>
                              {canFinancial && (
                                <div className="shrink-0 text-[13px] font-bold text-ink">
                                  {money(l.lineTotal)}
                                </div>
                              )}
                            </div>
                          ))}
                          <div className="mt-2 border-t border-line pt-2 text-[11.5px] font-semibold text-ink-light">
                            Recorded by {full.createdByName || "—"}
                            {canFinancial
                              ? ` · subtotal ${money(full.subtotal)} · total ${money(full.total)}`
                              : ""}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
