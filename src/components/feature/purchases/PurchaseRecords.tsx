"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Receipt, Search, Trash2, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import {
  fetchPurchaseInvoice,
  fetchPurchaseInvoices,
  fetchPurchaseReturns,
  fetchSupplierPayments,
  rpcCancelPurchaseInvoice,
  rpcCancelPurchaseReturn,
  rpcDeleteSupplierPayment,
} from "@/lib/supabase-data";
import { supplierTypeLabel } from "@/lib/supplier";
import { DateRangeFilter } from "@/components/ui/DateRangePicker";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DateRange } from "@/lib/date-range";
import type { InvoiceStatus, PurchaseInvoice, SupplierType } from "@/lib/types";

// `!w-auto` overrides the global `select { width: 100% }`, which would otherwise
// let each select eat the search field's space in this flex row.
const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

const STATUS_TONE: Record<string, string> = {
  posted: "bg-success-bg text-success",
  draft: "bg-cream-dark text-ink-muted",
  // A withdrawn record counts for nothing — it should read as a warning, not as
  // muted background noise.
  cancelled: "bg-danger-bg text-danger",
};

type Kind = "purchase" | "payment" | "return";

const KIND_LABEL: Record<Kind, string> = {
  purchase: "Purchase",
  payment: "Payment",
  return: "Return",
};

/** One row of the ledger, whichever of the three tables it came from. */
interface Entry {
  key: string;
  id: string;
  kind: Kind;
  date: string;
  reference: string;
  supplier: string;
  supplierType: SupplierType;
  detail: string;
  amount: number;
  status: InvoiceStatus;
  /** True when the row moved money the other way — a payment or a credit note. */
  reduces: boolean;
}

/** What removing a given row actually does. Cancels reverse stock; only a
 *  payment truly deletes, because a payment never moved any. */
interface Removal {
  entry: Entry;
  /** Cancels demand a reason; the delete does not. */
  needsReason: boolean;
  verb: "Cancel" | "Delete";
  warning: string;
}

export function PurchaseRecords() {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const reloadStore = useBakeryStore((s) => s.load);
  const toast = useUIStore((s) => s.toast);
  const canFinancial = hasPermission(user, "suppliers.financial");
  const canCancelInvoice = hasPermission(user, "purchases.create");
  const canDeletePayment = hasPermission(user, "purchases.pay");
  const canCancelReturn = hasPermission(user, "purchases.return");
  // Recording the removal as wastage is the same decision write_off_batch and
  // stock_out own, so it carries their key.
  const canWriteOff = hasPermission(user, "stock.expiry");

  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [token, setToken] = useState(0);

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [type, setType] = useState<SupplierType | "all">("all");
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");

  // Invoice lines, fetched the first time a purchase row is opened.
  const [openId, setOpenId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, PurchaseInvoice>>({});
  const [loadingLines, setLoadingLines] = useState(false);

  const [removing, setRemoving] = useState<Removal | null>(null);
  const [reason, setReason] = useState("");
  // Cancelling a posted purchase always removes the stock; this decides whether
  // that removal is recorded as a loss or treated as "it never arrived".
  const [writeOff, setWriteOff] = useState(false);
  const [busy, setBusy] = useState(false);

  // Modal focuses its first field on mount, which for a posted purchase is the
  // write-off checkbox. The reason is what actually has to be typed, so it is
  // focused explicitly. This effect belongs to Modal's PARENT, so it runs after
  // Modal's mount effect and wins.
  const reasonRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (removing?.needsReason) reasonRef.current?.focus();
  }, [removing]);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    Promise.all([
      fetchPurchaseInvoices({ range }),
      fetchSupplierPayments({ range }),
      fetchPurchaseReturns({ range }),
    ])
      .then(([invoices, payments, returns]) => {
        if (!alive) return;
        const rows: Entry[] = [
          ...invoices.map((i) => ({
            key: `i-${i.id}`,
            id: i.id,
            kind: "purchase" as Kind,
            date: i.purchaseDate,
            reference: i.invoiceNo ?? i.internalRef ?? "—",
            supplier: i.supplierName,
            supplierType: i.supplierType,
            // Once withdrawn, why it was withdrawn matters more than the note
            // that was taken when it was entered.
            detail: i.status === "cancelled" && i.cancelReason ? i.cancelReason : i.notes,
            amount: i.total,
            status: i.status,
            reduces: false,
          })),
          ...payments.map((p) => ({
            key: `p-${p.id}`,
            id: p.id,
            kind: "payment" as Kind,
            date: p.paidOn,
            reference: p.referenceNo || p.invoiceNo || "On account",
            supplier: p.supplierName,
            // A payment can only ever be to an external supplier.
            supplierType: "external" as SupplierType,
            detail: p.mode,
            amount: p.amount,
            status: "posted" as InvoiceStatus,
            reduces: true,
          })),
          ...returns.map((r) => ({
            key: `r-${r.id}`,
            id: r.id,
            kind: "return" as Kind,
            date: r.returnDate,
            reference: r.invoiceNo ?? "—",
            supplier: r.supplierName,
            supplierType: "external" as SupplierType,
            detail: r.status === "cancelled" && r.cancelReason ? r.cancelReason : r.reason,
            amount: r.total,
            status: r.status,
            reduces: true,
          })),
        ];
        // ISO dates sort lexically, so newest-first needs no Date construction.
        rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        setEntries(rows);
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
    return entries.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      if (type !== "all" && e.supplierType !== type) return false;
      if (status !== "all" && e.status !== status) return false;
      if (!q) return true;
      return (
        e.supplier.toLowerCase().includes(q) || e.reference.toLowerCase().includes(q)
      );
    });
  }, [entries, search, kind, type, status]);

  // Only posted rows are money that counts: a draft has not happened and a
  // cancelled row has been withdrawn.
  const net = useMemo(
    () =>
      visible
        .filter((e) => e.status === "posted")
        .reduce((s, e) => s + (e.reduces ? -e.amount : e.amount), 0),
    [visible],
  );

  const money = (n: number) => `${currency || "₹"}${n.toFixed(2)}`;

  const canRemove = (e: Entry) => {
    if (e.status === "cancelled") return false;
    if (e.kind === "purchase") return canCancelInvoice;
    if (e.kind === "payment") return canDeletePayment;
    return canCancelReturn && e.status === "posted";
  };

  const removalFor = (e: Entry): Removal =>
    e.kind === "payment"
      ? {
          entry: e,
          needsReason: false,
          verb: "Delete",
          warning:
            "The payment is removed for good and the supplier's outstanding balance " +
            "goes back up by this amount. The removal itself is logged.",
        }
      : e.kind === "purchase"
        ? {
            entry: e,
            needsReason: true,
            verb: "Cancel",
            warning:
              e.status === "posted"
                ? "The stock this invoice added is taken back out and the invoice stops " +
                  "counting towards anything. It is refused if a payment or a return " +
                  "references it, or if the stock has already been sold — raise a return " +
                  "instead."
                : "The draft is withdrawn. It never touched stock, so nothing else changes.",
          }
        : {
            entry: e,
            needsReason: true,
            verb: "Cancel",
            warning:
              "The returned stock goes back into inventory under the invoice it arrived " +
              "on, and the supplier credit is withdrawn.",
          };

  const open = async (e: Entry) => {
    if (e.kind !== "purchase") return;
    if (openId === e.id) {
      setOpenId(null);
      return;
    }
    setOpenId(e.id);
    if (lines[e.id]) return;
    setLoadingLines(true);
    try {
      const full = await fetchPurchaseInvoice(e.id);
      if (full) setLines((m) => ({ ...m, [e.id]: full }));
    } catch {
      toast("Couldn't load that invoice's lines", "error");
    } finally {
      setLoadingLines(false);
    }
  };

  // Only a posted purchase has stock to write off — a draft never created any,
  // and a return is sending goods back rather than losing them.
  const offersWriteOff =
    canWriteOff && removing?.entry.kind === "purchase" && removing.entry.status === "posted";

  const confirmRemoval = async () => {
    if (!removing) return;
    const { entry, needsReason, verb } = removing;
    if (needsReason && !reason.trim()) return;
    setBusy(true);
    try {
      if (entry.kind === "purchase") {
        await rpcCancelPurchaseInvoice(entry.id, reason, offersWriteOff && writeOff);
      }
      else if (entry.kind === "payment") await rpcDeleteSupplierPayment(entry.id);
      else await rpcCancelPurchaseReturn(entry.id, reason);

      toast(
        verb === "Delete"
          ? `Payment of ${money(entry.amount)} removed`
          : `${KIND_LABEL[entry.kind]} ${entry.reference} cancelled${
              offersWriteOff && writeOff ? " — stock written off" : ""
            }`,
        "success",
      );
      // Cancelling an invoice or a return moves stock, so the item cache is stale.
      if (entry.kind !== "payment") await reloadStore();
      setRemoving(null);
      setReason("");
      setWriteOff(false);
      setOpenId(null);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove that record", "error");
    } finally {
      setBusy(false);
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
            placeholder="Search supplier, invoice or reference…"
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
          aria-label="Record kind"
          className={selectCls}
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind | "all")}
        >
          <option value="all">All records</option>
          <option value="purchase">Purchases</option>
          <option value="payment">Payments</option>
          <option value="return">Returns</option>
        </select>
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
          <option value="all">All statuses</option>
          <option value="posted">Posted</option>
          <option value="draft">Draft</option>
          <option value="cancelled">Cancelled</option>
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
            {entries.length === 0
              ? "Nothing recorded in this period."
              : "No records match your filters."}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] font-semibold text-ink-muted">
            {visible.length} record{visible.length === 1 ? "" : "s"}
            {canFinancial ? ` · ${money(net)} net posted` : ""}
          </p>
          <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
            {visible.map((e) => {
              const isOpen = openId === e.id && e.kind === "purchase";
              const full = lines[e.id];
              const expandable = e.kind === "purchase";
              return (
                <div key={e.key} className="border-t border-line-soft first:border-t-0">
                  <div className="flex items-center gap-1 pr-2 hover:bg-cream/60">
                    <button
                      type="button"
                      onClick={() => open(e)}
                      aria-expanded={expandable ? isOpen : undefined}
                      disabled={!expandable}
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left disabled:cursor-default"
                    >
                      <span className="shrink-0 text-ink-light">
                        {expandable ? (
                          isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                        ) : (
                          <span className="inline-block w-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold text-ink">
                          {KIND_LABEL[e.kind]} · {e.reference}
                        </div>
                        <div className="truncate text-[12px] font-semibold text-ink-light">
                          {e.date} · {e.supplier}
                          {e.kind === "purchase" ? ` · ${supplierTypeLabel(e.supplierType)}` : ""}
                          {e.detail ? ` · ${e.detail}` : ""}
                        </div>
                      </div>
                      {e.status !== "posted" && (
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_TONE[e.status]}`}
                        >
                          {e.status}
                        </span>
                      )}
                      {canFinancial && (
                        <div className="shrink-0 text-right text-[13.5px] font-bold text-ink">
                          {/* A payment and a credit note both reduce what is
                              owed, so both read as negative against a purchase. */}
                          {e.reduces ? `−${money(e.amount)}` : money(e.amount)}
                        </div>
                      )}
                    </button>
                    {canRemove(e) && (
                      <button
                        type="button"
                        aria-label={`${removalFor(e).verb} ${KIND_LABEL[e.kind].toLowerCase()} ${e.reference}`}
                        title={`${removalFor(e).verb} this ${KIND_LABEL[e.kind].toLowerCase()}`}
                        onClick={() => {
                          setRemoving(removalFor(e));
                          setReason("");
                          setWriteOff(false);
                        }}
                        className="shrink-0 rounded-full p-2 text-ink-light hover:bg-danger-bg hover:text-danger"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>

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
                              ? ` · subtotal ${money(full.subtotal)}${
                                  full.gstAmount == null
                                    ? " · no GST"
                                    : ` · GST ${money(full.gstAmount)}`
                                } · total ${money(full.total)}`
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

      {removing && (
        <Modal
          title={`${removing.verb} ${KIND_LABEL[removing.entry.kind].toLowerCase()} ${removing.entry.reference}`}
          onClose={() => {
            setRemoving(null);
            setReason("");
            setWriteOff(false);
          }}
        >
          <p className="mb-3.5 text-sm text-ink-muted">{removing.warning}</p>

          <div className="mb-3.5 rounded-xl bg-cream px-3.5 py-3 text-[13px] font-semibold text-ink">
            <div className="flex justify-between">
              <span>{removing.entry.supplier}</span>
              <span>{money(removing.entry.amount)}</span>
            </div>
            <div className="mt-0.5 text-[12px] font-semibold text-ink-light">
              {removing.entry.date}
              {removing.entry.detail ? ` · ${removing.entry.detail}` : ""}
            </div>
          </div>

          {offersWriteOff && (
            <label className="mb-3.5 flex cursor-pointer select-none items-start gap-2.5 rounded-xl border border-line bg-warm-white px-[13px] py-[11px]">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-brown"
                checked={writeOff}
                onChange={(ev) => setWriteOff(ev.target.checked)}
              />
              <span className="text-[13px]">
                <span className="font-bold text-ink">Write the stock off as a loss</span>
                <span className="mt-0.5 block text-[12px] font-semibold text-ink-light">
                  {writeOff
                    ? "The goods arrived and are unusable. Each line is logged as a Write-off movement, so the loss shows in the stock log and wastage figures."
                    : "Leave unticked if this invoice was never real — the stock is simply reversed and no loss is recorded."}
                </span>
              </span>
            </label>
          )}

          {removing.needsReason && (
            <div className="mb-3.5">
              <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]" htmlFor="rm-reason">
                Reason
              </label>
              <input
                id="rm-reason"
                ref={reasonRef}
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                // Enter submits, so a short reason does not need a trip to the
                // mouse. Guarded on the same condition as the button.
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy && reason.trim()) void confirmRemoval();
                }}
                placeholder="e.g. Keyed against the wrong supplier"
              />
              <p className="mt-1 text-[11.5px] text-ink-muted">
                Recorded in the activity log, which cannot be edited afterwards.
              </p>
            </div>
          )}

          <button
            type="button"
            className="btn-danger flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={confirmRemoval}
            disabled={busy || (removing.needsReason && !reason.trim())}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {busy
              ? "Working…"
              : `${removing.verb} ${KIND_LABEL[removing.entry.kind].toLowerCase()}`}
          </button>
        </Modal>
      )}
    </>
  );
}
