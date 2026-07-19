"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  ClipboardList,
  Loader2,
  PackageMinus,
  PackagePlus,
  Receipt as ReceiptIcon,
  ReceiptText,
  KeyRound,
  Search,
  Settings,
  Store,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { formatDateFull, initials } from "@/lib/format";
import {
  fetchAdminLogsPage,
  fetchBillsPage,
  fetchLogsPage,
  type BillFilters,
  type LogFilters,
} from "@/lib/supabase-data";
import { tabCls } from "@/components/ui/tabClass";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { DateRangeFilter } from "@/components/ui/DateRangePicker";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import type { DateRange } from "@/lib/date-range";
import type { Bill, BillStatus, Log } from "@/lib/types";

type StatusFilter = "All" | "Active" | "Cancelled";
type LogTypeFilter = Log["type"] | "all";

const PAGE_SIZE = 30;
const EMPTY_RANGE: DateRange = { from: null, to: null };

const STOCK_TYPE_OPTIONS: { value: LogTypeFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "in", label: "Stock in" },
  { value: "out", label: "Stock out" },
  { value: "bill", label: "Bill generated" },
  { value: "cancel", label: "Bill cancelled" },
  { value: "delete", label: "Bill deleted" },
];

const ADMIN_TYPE_OPTIONS: { value: LogTypeFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "open", label: "Store opened" },
  { value: "close", label: "Store closed" },
  { value: "settings", label: "Settings updated" },
  { value: "staff_add", label: "Staff added" },
  { value: "staff_edit", label: "Staff updated" },
  { value: "staff_remove", label: "Staff removed" },
  { value: "password", label: "Password changed" },
];

// Debounce a fast-changing value (search box) so each keystroke doesn't fire a
// server query.
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

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

// Cache the default (unfiltered) window per user so navigating back to History
// paints instantly while it revalidates. Filtered views are never cached.
let billsCache: { uid: string; bills: Bill[]; more: boolean } | null = null;
let logsCache: { uid: string; logs: Log[]; more: boolean } | null = null;

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

const selectCls =
  "!w-auto shrink-0 rounded-xl border border-line bg-warm-white px-3 py-[11px] text-[13.5px] font-semibold text-ink-muted focus:border-brown";

const logIcon = (t: Log["type"]) =>
  t === "in" ? PackagePlus
    : t === "out" ? PackageMinus
    : t === "cancel" ? Ban
    : t === "delete" ? Trash2
    : t === "open" || t === "close" ? Store
    : t === "settings" ? Settings
    : t === "staff_add" ? UserPlus
    : t === "staff_edit" ? UserCog
    : t === "staff_remove" ? UserMinus
    : t === "password" ? KeyRound
    : ReceiptIcon;

const logTone = (t: Log["type"]): "success" | "danger" | "brown" =>
  t === "in" || t === "open" || t === "staff_add" ? "success"
    : t === "out" || t === "cancel" || t === "delete" || t === "close" || t === "staff_remove" ? "danger"
    : "brown";

const toneClasses: Record<"success" | "danger" | "brown", { bg: string; text: string }> = {
  success: { bg: "bg-success-bg", text: "text-success" },
  danger: { bg: "bg-danger-bg", text: "text-danger" },
  brown: { bg: "bg-cream-dark", text: "text-brown" },
};

const LOG_LABELS: Record<Log["type"], string> = {
  in: "Stock in",
  out: "Stock out",
  bill: "Bill generated",
  cancel: "Bill cancelled",
  delete: "Bill deleted",
  open: "Store opened",
  close: "Store closed",
  settings: "Store settings updated",
  staff_add: "Staff added",
  staff_edit: "Staff updated",
  staff_remove: "Staff removed",
  password: "Password changed",
};
const logTypeLabel = (t: Log["type"]) => LOG_LABELS[t];

const logMeta = (l: Log) => {
  const parts: string[] = [];
  if (l.user) parts.push(`By ${l.user}`);
  if (l.supplier) parts.push(`Supplier: ${l.supplier}`);
  if (l.reason) parts.push(`Reason: ${l.reason}`);
  if (l.notes) parts.push(l.notes);
  if (l.items) parts.push(l.items);
  return parts.join(" · ");
};

// Shared filter bar for the two activity-log tabs: text search + type select +
// date range (on its own row so it never crowds the controls above).
function LogFilterBar({
  search,
  onSearch,
  type,
  onType,
  typeOptions,
  range,
  onRange,
}: {
  search: string;
  onSearch: (v: string) => void;
  type: LogTypeFilter;
  onType: (v: LogTypeFilter) => void;
  typeOptions: { value: LogTypeFilter; label: string }[];
  range: DateRange;
  onRange: (r: DateRange) => void;
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
          <input
            type="text"
            placeholder="Search item, staff or notes…"
            className="w-full pl-9 pr-9"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-light hover:bg-cream hover:text-ink-muted"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <select
          value={type}
          onChange={(e) => onType(e.target.value as LogTypeFilter)}
          aria-label="Filter by type"
          className={selectCls}
        >
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-3.5">
        <DateRangeFilter value={range} onChange={onRange} />
      </div>
    </>
  );
}

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
  const isOwner = user?.role === "Owner";
  const [tab, setTab] = useState<"bills" | "logs" | "store">(canSales ? "bills" : "logs");
  const [viewBill, setViewBill] = useState<Bill | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Bill | null>(null);

  // ─── Bills ────────────────────────────────────────────────────────────────
  const cachedBills = billsCache && billsCache.uid === user?.id ? billsCache : null;
  const [bills, setBills] = useState<Bill[]>(cachedBills?.bills ?? []);
  const [billsMore, setBillsMore] = useState(cachedBills?.more ?? false);
  const [billsLoaded, setBillsLoaded] = useState(cachedBills != null);
  const [billsError, setBillsError] = useState(false);
  const [billsRetry, setBillsRetry] = useState(0);
  const [loadingBills, setLoadingBills] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [billRange, setBillRange] = useState<DateRange>(EMPTY_RANGE);
  const debSearch = useDebounced(search, 300);

  const billFilters = useMemo<BillFilters>(
    () => ({
      q: debSearch.trim() || undefined,
      status: statusFilter === "All" ? undefined : (statusFilter.toLowerCase() as BillStatus),
      from: billRange.from,
      to: billRange.to,
    }),
    [debSearch, statusFilter, billRange.from, billRange.to],
  );
  const billsFiltered = !!(billFilters.q || billFilters.status || billFilters.from || billFilters.to);

  // ─── Stock log ───────────────────────────────────────────────────────────
  const cachedLogs = logsCache && logsCache.uid === user?.id ? logsCache : null;
  const [logs, setLogs] = useState<Log[]>(cachedLogs?.logs ?? []);
  const [logsMore, setLogsMore] = useState(cachedLogs?.more ?? false);
  const [logsLoaded, setLogsLoaded] = useState(cachedLogs != null);
  const [logsError, setLogsError] = useState(false);
  const [logsRetry, setLogsRetry] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logType, setLogType] = useState<LogTypeFilter>("all");
  const [logRange, setLogRange] = useState<DateRange>(EMPTY_RANGE);
  const debLogSearch = useDebounced(logSearch, 300);

  const logFilters = useMemo<LogFilters>(
    () => ({
      q: debLogSearch.trim() || undefined,
      type: logType,
      from: logRange.from,
      to: logRange.to,
    }),
    [debLogSearch, logType, logRange.from, logRange.to],
  );
  const logsFiltered = !!(logFilters.q || logType !== "all" || logRange.from || logRange.to);

  // ─── Store (admin) log ─────────────────────────────────────────────────────
  const [adminLogs, setAdminLogs] = useState<Log[]>([]);
  const [adminLogsMore, setAdminLogsMore] = useState(false);
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [adminError, setAdminError] = useState(false);
  const [adminRetry, setAdminRetry] = useState(0);
  const [loadingAdminLogs, setLoadingAdminLogs] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminType, setAdminType] = useState<LogTypeFilter>("all");
  const [adminRange, setAdminRange] = useState<DateRange>(EMPTY_RANGE);
  const debAdminSearch = useDebounced(adminSearch, 300);

  const adminFilters = useMemo<LogFilters>(
    () => ({
      q: debAdminSearch.trim() || undefined,
      type: adminType,
      from: adminRange.from,
      to: adminRange.to,
    }),
    [debAdminSearch, adminType, adminRange.from, adminRange.to],
  );

  const [busyBill, setBusyBill] = useState<Set<string>>(new Set());
  const setBillBusy = (id: string, on: boolean) =>
    setBusyBill((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Load bills (page 0) whenever the filters change. `billsLoaded` only gates
  // the first-ever paint — filter reloads keep the current list visible until
  // the new data lands, and never flash the skeleton over cached rows.
  useEffect(() => {
    if (!canSales) return;
    let alive = true;
    setBillsError(false);
    const window = billsFiltered ? PAGE_SIZE : Math.max(billsCache?.bills.length ?? 0, PAGE_SIZE);
    fetchBillsPage(0, window, billFilters)
      .then((p) => {
        if (!alive) return;
        setBills(p.bills);
        setBillsMore(p.hasMore);
        setBillsLoaded(true);
        if (!billsFiltered && user?.id) billsCache = { uid: user.id, bills: p.bills, more: p.hasMore };
      })
      .catch(() => {
        if (!alive) return;
        setBillsError(true);
        setBillsLoaded(true);
        if (billsLoaded) toast("Couldn't load bills", "error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSales, billFilters, billsRetry]);

  // Load stock-log (page 0) on filter change.
  useEffect(() => {
    if (!canInv) return;
    let alive = true;
    setLogsError(false);
    const window = logsFiltered ? PAGE_SIZE : Math.max(logsCache?.logs.length ?? 0, PAGE_SIZE);
    fetchLogsPage(0, window, logFilters)
      .then((p) => {
        if (!alive) return;
        setLogs(p.logs);
        setLogsMore(p.hasMore);
        setLogsLoaded(true);
        if (!logsFiltered && user?.id) logsCache = { uid: user.id, logs: p.logs, more: p.hasMore };
      })
      .catch(() => {
        if (!alive) return;
        setLogsError(true);
        setLogsLoaded(true);
        if (logsLoaded) toast("Couldn't load activity", "error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canInv, logFilters, logsRetry]);

  // Load store/admin log (page 0) on filter change.
  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    setAdminError(false);
    fetchAdminLogsPage(0, PAGE_SIZE, adminFilters)
      .then((p) => {
        if (!alive) return;
        setAdminLogs(p.logs);
        setAdminLogsMore(p.hasMore);
        setAdminLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setAdminError(true);
        setAdminLoaded(true);
        if (adminLoaded) toast("Couldn't load activity", "error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, adminFilters, adminRetry]);

  const loadMoreBills = async () => {
    setLoadingBills(true);
    try {
      const p = await fetchBillsPage(bills.length, PAGE_SIZE, billFilters);
      setBills((prev) => [...prev, ...p.bills]);
      setBillsMore(p.hasMore);
    } catch {
      toast("Couldn't load more bills", "error");
    } finally {
      setLoadingBills(false);
    }
  };

  const loadMoreLogs = async () => {
    setLoadingLogs(true);
    try {
      const p = await fetchLogsPage(logs.length, PAGE_SIZE, logFilters);
      setLogs((prev) => [...prev, ...p.logs]);
      setLogsMore(p.hasMore);
    } catch {
      toast("Couldn't load more activity", "error");
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadMoreAdminLogs = async () => {
    setLoadingAdminLogs(true);
    try {
      const p = await fetchAdminLogsPage(adminLogs.length, PAGE_SIZE, adminFilters);
      setAdminLogs((prev) => [...prev, ...p.logs]);
      setAdminLogsMore(p.hasMore);
    } catch {
      toast("Couldn't load more activity", "error");
    } finally {
      setLoadingAdminLogs(false);
    }
  };

  // After a cancel/delete, re-fetch the loaded windows (with current filters) so
  // the change and the new activity-log entry are reflected.
  const refreshLoaded = async () => {
    const [bp, lp] = await Promise.all([
      fetchBillsPage(0, Math.max(bills.length, PAGE_SIZE), billFilters),
      canInv ? fetchLogsPage(0, Math.max(logs.length, PAGE_SIZE), logFilters) : Promise.resolve(null),
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

  const doCancel = (b: Bill) => {
    if (b.status === "cancelled") {
      toast("Already cancelled", "error");
      return;
    }
    setConfirmCancel(b);
  };

  const confirmCancelNow = async () => {
    const b = confirmCancel;
    if (!b) return;
    setConfirmCancel(null);
    setBillBusy(b.id, true);
    try {
      const r = await cancelBill(b.id, user?.name ?? "Unknown");
      if (r.ok) {
        toast(`Bill #${b.billNo} cancelled`, "success");
        await refreshLoaded();
      } else if (r.error) toast(r.error, "error");
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
          toast(`Bill #${b.billNo} deleted`, "success");
          await refreshLoaded();
        } else if (r.error) toast(r.error, "error");
      } finally {
        setBillBusy(b.id, false);
      }
    });
  };

  const errorState = (label: string, onRetry: () => void) => (
    <div className="px-5 py-10 text-center text-ink-muted">
      <div className="mb-3 flex justify-center">
        <AlertTriangle size={44} className="text-danger" />
      </div>
      <p className="mb-3 text-sm">{label}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
      >
        Retry
      </button>
    </div>
  );

  const loadMoreButton = (loading: boolean, onClick: () => void) => (
    <div className="mt-3 text-center">
      <button
        className="btn-secondary inline-flex items-center justify-center gap-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onClick}
        disabled={loading}
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex w-fit gap-1.5 rounded-xl bg-[#f4e7d2] p-1">
        {canSales && (
          <button className={tabCls(tab === "bills")} onClick={() => setTab("bills")}>Bills</button>
        )}
        {canInv && (
          <button className={tabCls(tab === "logs")} onClick={() => setTab("logs")}>Stock Log</button>
        )}
        {isOwner && (
          <button className={tabCls(tab === "store")} onClick={() => setTab("store")}>Store</button>
        )}
      </div>

      {tab === "bills" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
              <input
                type="text"
                placeholder="Search by bill # or customer…"
                className="w-full pl-9 pr-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-light hover:bg-cream hover:text-ink-muted"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {(["All", "Active", "Cancelled"] as const).map((f) => (
                <button key={f} className={chipCls(statusFilter === f)} onClick={() => setStatusFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3.5">
            <DateRangeFilter value={billRange} onChange={setBillRange} />
          </div>

          {!billsLoaded ? (
            <BillsSkeleton />
          ) : billsError && bills.length === 0 ? (
            errorState("Couldn't load bills.", () => {
              setBillsLoaded(false);
              setBillsRetry((t) => t + 1);
            })
          ) : bills.length === 0 ? (
            <div className="px-5 py-10 text-center text-ink-muted">
              <div className="mb-3 flex justify-center">
                <ReceiptText size={48} />
              </div>
              <p className="text-sm">{billsFiltered ? "No bills match your filters" : "No bills generated yet"}</p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
                {bills.map((b) => {
                  const cancelled = b.status === "cancelled";
                  return (
                    <div key={b.id} className="flex flex-wrap items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
                      <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#f4e7d2] text-[13px] font-bold text-brown">
                        {billerInitials(b.customerName)}
                      </div>
                      <div className="min-w-0 flex-1 basis-[calc(100%_-_3.5rem)] sm:basis-0">
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
                      <div className="ml-auto flex shrink-0 gap-1.5">
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
              {billsMore && loadMoreButton(loadingBills, loadMoreBills)}
            </>
          )}
        </>
      )}

      {tab === "logs" && (
        <>
          <LogFilterBar
            search={logSearch}
            onSearch={setLogSearch}
            type={logType}
            onType={setLogType}
            typeOptions={STOCK_TYPE_OPTIONS}
            range={logRange}
            onRange={setLogRange}
          />
          {!logsLoaded ? (
            <LogsSkeleton />
          ) : logsError && logs.length === 0 ? (
            errorState("Couldn't load activity.", () => {
              setLogsLoaded(false);
              setLogsRetry((t) => t + 1);
            })
          ) : logs.length === 0 ? (
            <div className="px-5 py-10 text-center text-ink-muted">
              <div className="mb-3 flex justify-center">
                <ClipboardList size={48} />
              </div>
              <p className="text-sm">{logsFiltered ? "No activity matches your filters" : "No activity yet"}</p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
                {logs.map((l) => {
                  const tone = toneClasses[logTone(l.type)];
                  const isStock = l.type === "in" || l.type === "out";
                  const isStore = l.type === "open" || l.type === "close";
                  const sign = l.type === "in" ? "+" : "−";
                  const Icon = logIcon(l.type);
                  return (
                    <div key={l.id} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] ${tone.bg} ${tone.text}`}>
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-ink">
                          {isStock
                            ? `${itemEmoji(l.itemId)} ${l.itemName}`
                            : isStore
                              ? "Store"
                              : `Bill #${l.billNo}`}
                        </div>
                        <div className="break-words text-xs text-ink-light">
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
              {logsMore && loadMoreButton(loadingLogs, loadMoreLogs)}
            </>
          )}
        </>
      )}

      {tab === "store" && (
        <>
          <LogFilterBar
            search={adminSearch}
            onSearch={setAdminSearch}
            type={adminType}
            onType={setAdminType}
            typeOptions={ADMIN_TYPE_OPTIONS}
            range={adminRange}
            onRange={setAdminRange}
          />
          {!adminLoaded ? (
            <LogsSkeleton />
          ) : adminError && adminLogs.length === 0 ? (
            errorState("Couldn't load store activity.", () => {
              setAdminLoaded(false);
              setAdminRetry((t) => t + 1);
            })
          ) : adminLogs.length === 0 ? (
            <div className="px-5 py-10 text-center text-ink-muted">
              <div className="mb-3 flex justify-center">
                <Store size={48} />
              </div>
              <p className="text-sm">No store or staff activity yet</p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
                {adminLogs.map((l) => {
                  const tone = toneClasses[logTone(l.type)];
                  const Icon = logIcon(l.type);
                  return (
                    <div key={l.id} className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] ${tone.bg} ${tone.text}`}>
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-ink">{logTypeLabel(l.type)}</div>
                        {logMeta(l) && (
                          <div className="break-words text-xs text-ink-light">{logMeta(l)}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-right text-[11.5px] text-ink-light">
                        {formatDateFull(l.date)}
                      </div>
                    </div>
                  );
                })}
              </div>
              {adminLogsMore && loadMoreButton(loadingAdminLogs, loadMoreAdminLogs)}
            </>
          )}
        </>
      )}

      {viewBill && <ViewBillModal bill={viewBill} onClose={() => setViewBill(null)} />}

      {confirmCancel && (
        <Modal title="Cancel bill" onClose={() => setConfirmCancel(null)}>
          <p className="text-sm text-ink-muted">
            Cancel <span className="font-bold text-ink">Bill #{confirmCancel.billNo}</span>? Stock
            quantities will be restored.
          </p>
          <div className="mt-5 flex gap-2.5">
            <button className="btn-secondary flex-1" onClick={() => setConfirmCancel(null)}>
              Back
            </button>
            <button
              className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-none bg-warn p-3 text-sm font-bold text-white"
              onClick={confirmCancelNow}
            >
              <Ban size={16} /> Cancel bill
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
