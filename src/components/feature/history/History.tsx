"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  ClipboardList,
  Loader2,
  PackageMinus,
  PackagePlus,
  Receipt as ReceiptIcon,
  ReceiptText,
  Search,
  Trash2,
} from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { formatDateFull, initials } from "@/lib/format";
import { fetchBillsPage, fetchLogsPage } from "@/lib/supabase-data";
import { tabCls } from "@/components/ui/tabClass";
import { Skeleton } from "@/components/ui/Skeleton";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import type { Bill, Log } from "@/lib/types";

type StatusFilter = "All" | "Active" | "Cancelled";

const PAGE_SIZE = 30;

const rowsSkeleton = (rows: React.ReactNode) => (
  <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
    {rows}
  </div>
);

const BillsSkeleton = () =>
  rowsSkeleton(
    [0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
        <Skeleton className="h-[42px] w-[42px] rounded-[11px]" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
    )),
  );

const LogsSkeleton = () =>
  rowsSkeleton(
    [0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
        <Skeleton className="h-10 w-10 rounded-[11px]" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-4 w-14" />
      </div>
    )),
  );

// Cache the loaded pages (keyed by user) so navigating back to History renders
// instantly while the loaded window revalidates in the background.
let histCache: {
  uid: string;
  bills: Bill[];
  billsMore: boolean;
  logs: Log[];
  logsMore: boolean;
} | null = null;

// "Walk-in" (the no-name placeholder) always renders as a single "W" rather
// than initials-of-two-words; every other name defers to the shared helper.
const billerInitials = (name: string) => {
  const n = (name || "Walk-in").trim();
  return !n || n.toLowerCase() === "walk-in" ? "W" : initials(n);
};

const chipCls = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-[15px] py-[7px] text-[13px] font-bold transition-colors ${
    active ? "border-brown bg-brown text-warm-white" : "border-line bg-warm-white text-ink-muted"
  }`;

const logIcon = (t: Log["type"]) =>
  t === "in" ? PackagePlus : t === "out" ? PackageMinus : t === "cancel" ? Ban : t === "delete" ? Trash2 : ReceiptIcon;

const logTone = (t: Log["type"]): "success" | "danger" | "brown" =>
  t === "in" ? "success" : t === "out" || t === "cancel" || t === "delete" ? "danger" : "brown";

const toneClasses: Record<"success" | "danger" | "brown", { bg: string; text: string }> = {
  success: { bg: "bg-success-bg", text: "text-success" },
  danger: { bg: "bg-danger-bg", text: "text-danger" },
  brown: { bg: "bg-cream-dark", text: "text-brown" },
};

const logTypeLabel = (t: Log["type"]) =>
  t === "in"
    ? "Stock in"
    : t === "out"
      ? "Stock out"
      : t === "cancel"
        ? "Bill cancelled"
        : t === "delete"
          ? "Bill deleted"
          : "Bill generated";

const logMeta = (l: Log) => {
  const parts: string[] = [];
  if (l.user) parts.push(`By ${l.user}`);
  if (l.supplier) parts.push(`Supplier: ${l.supplier}`);
  if (l.reason) parts.push(`Reason: ${l.reason}`);
  if (l.notes) parts.push(l.notes);
  if (l.items) parts.push(l.items);
  return parts.join(" · ");
};

export function History() {
  const user = useCurrentUser();
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const cancelBill = useBakeryStore((s) => s.cancelBill);
  const deleteBill = useBakeryStore((s) => s.deleteBill);
  const toast = useUIStore((s) => s.toast);
  const requireOwnerAuth = useUIStore((s) => s.requireOwnerAuth);

  const canSales = hasPermission(user, "sales");
  const canInv = hasPermission(user, "inventory");
  const [tab, setTab] = useState<"bills" | "logs">(canSales ? "bills" : "logs");
  const [viewBill, setViewBill] = useState<Bill | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

  // Bills and logs are paginated (newest first) rather than loaded in full.
  const cached = histCache && histCache.uid === user?.id ? histCache : null;
  const [bills, setBills] = useState<Bill[]>(cached?.bills ?? []);
  const [billsMore, setBillsMore] = useState(cached?.billsMore ?? false);
  const [logs, setLogs] = useState<Log[]>(cached?.logs ?? []);
  const [logsMore, setLogsMore] = useState(cached?.logsMore ?? false);
  const [loaded, setLoaded] = useState(cached != null);
  // Per-bill in-flight cancel/delete, and the two "Load more" buttons.
  const [busyBill, setBusyBill] = useState<Set<string>>(new Set());
  const [loadingBills, setLoadingBills] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const setBillBusy = (id: string, on: boolean) =>
    setBusyBill((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Persist the loaded window so a later visit renders it immediately.
  useEffect(() => {
    if (user?.id) histCache = { uid: user.id, bills, billsMore, logs, logsMore };
  }, [user?.id, bills, billsMore, logs, logsMore]);

  // Revalidate the loaded window on mount (keeps any "load more" expansion).
  useEffect(() => {
    let alive = true;
    const billWindow = Math.max(histCache?.bills.length ?? 0, PAGE_SIZE);
    const logWindow = Math.max(histCache?.logs.length ?? 0, PAGE_SIZE);
    (async () => {
      const jobs: Promise<void>[] = [];
      if (canSales)
        jobs.push(
          fetchBillsPage(0, billWindow).then((p) => {
            if (alive) {
              setBills(p.bills);
              setBillsMore(p.hasMore);
            }
          }),
        );
      if (canInv)
        jobs.push(
          fetchLogsPage(0, logWindow).then((p) => {
            if (alive) {
              setLogs(p.logs);
              setLogsMore(p.hasMore);
            }
          }),
        );
      await Promise.all(jobs);
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [canSales, canInv]);

  const loadMoreBills = async () => {
    setLoadingBills(true);
    try {
      const p = await fetchBillsPage(bills.length, PAGE_SIZE);
      setBills((prev) => [...prev, ...p.bills]);
      setBillsMore(p.hasMore);
    } finally {
      setLoadingBills(false);
    }
  };

  const loadMoreLogs = async () => {
    setLoadingLogs(true);
    try {
      const p = await fetchLogsPage(logs.length, PAGE_SIZE);
      setLogs((prev) => [...prev, ...p.logs]);
      setLogsMore(p.hasMore);
    } finally {
      setLoadingLogs(false);
    }
  };

  // After a cancel/delete, re-fetch the already-loaded window so the change
  // (status flip or removal) and the new activity-log entry are reflected.
  const refreshLoaded = async () => {
    const [bp, lp] = await Promise.all([
      fetchBillsPage(0, Math.max(bills.length, PAGE_SIZE)),
      canInv ? fetchLogsPage(0, Math.max(logs.length, PAGE_SIZE)) : Promise.resolve(null),
    ]);
    setBills(bp.bills);
    setBillsMore(bp.hasMore);
    if (lp) {
      setLogs(lp.logs);
      setLogsMore(lp.hasMore);
    }
  };

  // Lookup map built once per items change, so the logs list is O(logs) to
  // render instead of O(logs × items) from a find() per row.
  const emojiById = useMemo(() => new Map(items.map((i) => [i.id, i.emoji])), [items]);
  const itemEmoji = (itemId?: string) => (itemId && emojiById.get(itemId)) || "📦";

  const doCancel = async (b: Bill) => {
    if (b.status === "cancelled") {
      toast("Already cancelled");
      return;
    }
    if (!confirm(`Cancel Bill #${b.billNo}? Stock quantities will be restored.`)) return;
    setBillBusy(b.id, true);
    try {
      const r = await cancelBill(b.id, user?.name ?? "Unknown");
      if (r.ok) {
        toast(`Bill #${b.billNo} cancelled`);
        await refreshLoaded();
      } else if (r.error) toast(r.error);
    } finally {
      setBillBusy(b.id, false);
    }
  };

  const doDelete = (b: Bill) => {
    requireOwnerAuth(`permanently delete Bill #${b.billNo}`, async () => {
      setBillBusy(b.id, true);
      try {
        const r = await deleteBill(b.id, user?.name ?? "Unknown");
        if (r.ok) {
          toast(`Bill #${b.billNo} deleted`);
          await refreshLoaded();
        } else if (r.error) toast(r.error);
      } finally {
        setBillBusy(b.id, false);
      }
    });
  };

  // Recomputed only when the list or the filter/search inputs change, not on
  // every unrelated re-render.
  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (statusFilter !== "All" && b.status !== statusFilter.toLowerCase()) return false;
      if (!q) return true;
      const name = (b.customerName || "Walk-in").toLowerCase();
      return name.includes(q) || String(b.billNo).includes(q);
    });
  }, [bills, statusFilter, search]);

  return (
    <>
      <div className="mb-4 flex w-fit gap-1.5 rounded-xl bg-[#f4e7d2] p-1">
        {canSales && (
          <button className={tabCls(tab === "bills")} onClick={() => setTab("bills")}>Bills</button>
        )}
        {canInv && (
          <button className={tabCls(tab === "logs")} onClick={() => setTab("logs")}>Stock Log</button>
        )}
      </div>

      {tab === "bills" && (
        <>
          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
              <input
                type="text"
                placeholder="Search by bill # or customer…"
                className="w-full pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              {(["All", "Active", "Cancelled"] as const).map((f) => (
                <button key={f} className={chipCls(statusFilter === f)} onClick={() => setStatusFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {!loaded ? (
            <BillsSkeleton />
          ) : filteredBills.length === 0 ? (
            <div className="px-5 py-10 text-center text-ink-muted">
              <div className="mb-3 flex justify-center">
                <ReceiptText size={48} />
              </div>
              <p className="text-sm">{bills.length === 0 ? "No bills generated yet" : "No bills match your search"}</p>
            </div>
          ) : (
            <>
            <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
              {filteredBills.map((b) => {
                const cancelled = b.status === "cancelled";
                return (
                  <div key={b.id} className="flex flex-wrap items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
                    <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#f4e7d2] text-[13px] font-bold text-brown">
                      {billerInitials(b.customerName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-ink">{b.customerName || "Walk-in"}</div>
                      <div className="text-xs text-ink-light">
                        #{b.billNo} · {b.items.length} items · {formatDateFull(b.date)}
                      </div>
                      {cancelled && b.cancelledBy && (
                        <div className="mt-0.5 text-[11px] text-danger">Cancelled by {b.cancelledBy}</div>
                      )}
                    </div>
                    <span className={`badge ${cancelled ? "badge-danger" : "badge-success"}`}>
                      {cancelled ? "Cancelled" : "Active"}
                    </span>
                    <div className={`num shrink-0 text-right text-[15px] font-extrabold ${cancelled ? "text-ink-muted line-through" : "text-ink"}`}>
                      {currency}{b.total.toFixed(2)}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        className="btn-sm btn-secondary inline-flex items-center justify-center"
                        onClick={() => setViewBill(b)}
                        aria-label="View bill"
                      >
                        <ReceiptIcon size={16} />
                      </button>
                      {!cancelled && (
                        <button
                          className="inline-flex cursor-pointer items-center justify-center rounded-lg border-none bg-warn px-2.5 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => doCancel(b)}
                          disabled={busyBill.has(b.id)}
                          aria-label="Cancel bill"
                        >
                          {busyBill.has(b.id) ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                        </button>
                      )}
                      <button
                        className="inline-flex cursor-pointer items-center justify-center rounded-lg border-none bg-danger px-2.5 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => doDelete(b)}
                        disabled={busyBill.has(b.id)}
                        aria-label="Delete bill"
                      >
                        {busyBill.has(b.id) ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {billsMore && (
              <div className="mt-3 text-center">
                <button
                  className="btn-secondary inline-flex items-center justify-center gap-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={loadMoreBills}
                  disabled={loadingBills}
                >
                  {loadingBills && <Loader2 size={14} className="animate-spin" />}
                  {loadingBills ? "Loading…" : "Load more"}
                </button>
                {(search.trim() || statusFilter !== "All") && (
                  <p className="mt-1.5 text-[11px] text-ink-light">
                    Search &amp; filter apply to loaded bills — load more to include older ones.
                  </p>
                )}
              </div>
            )}
            </>
          )}
        </>
      )}

      {tab === "logs" && (
        !loaded ? (
          <LogsSkeleton />
        ) : logs.length === 0 ? (
          <div className="px-5 py-10 text-center text-ink-muted">
            <div className="mb-3 flex justify-center">
              <ClipboardList size={48} />
            </div>
            <p className="text-sm">No activity yet</p>
          </div>
        ) : (
          <>
          <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
            {logs.map((l) => {
              const tone = toneClasses[logTone(l.type)];
              const isStock = l.type === "in" || l.type === "out";
              const sign = l.type === "in" ? "+" : "−";
              const Icon = logIcon(l.type);
              return (
                <div key={l.id} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] ${tone.bg} ${tone.text}`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-ink">
                      {isStock ? `${itemEmoji(l.itemId)} ${l.itemName}` : `Bill #${l.billNo}`}
                    </div>
                    <div className="truncate text-xs text-ink-light">
                      {logTypeLabel(l.type)}
                      {logMeta(l) ? ` · ${logMeta(l)}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {isStock && l.qty != null && (
                      <div className={`num text-sm font-extrabold ${tone.text}`}>{sign}{l.qty}</div>
                    )}
                    {l.total != null && (
                      <div className="num text-sm font-extrabold text-ink">{currency}{l.total.toFixed(2)}</div>
                    )}
                    <div className="text-[11.5px] text-ink-light">{formatDateFull(l.date)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {logsMore && (
            <div className="mt-3 text-center">
              <button
                className="btn-secondary inline-flex items-center justify-center gap-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={loadMoreLogs}
                disabled={loadingLogs}
              >
                {loadingLogs && <Loader2 size={14} className="animate-spin" />}
                {loadingLogs ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
          </>
        )
      )}

      {viewBill && <ViewBillModal bill={viewBill} onClose={() => setViewBill(null)} />}
    </>
  );
}
