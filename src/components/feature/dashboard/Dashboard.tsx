"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Lightbulb, Download, Receipt, Plus } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { exportExcelReport } from "@/lib/excel";
import {
  fetchDashboardStats,
  fetchReportData,
  fetchBill,
  fetchCustomers,
  type DashboardStats,
} from "@/lib/supabase-data";
import { bucketSeries, categoryPLFrom, stockHealthFrom, recommendationsFrom } from "@/lib/analytics";
import { last7Days, type DateRange } from "@/lib/date-range";
import { expiryStatus } from "@/lib/expiry";
import { ItemModal } from "@/components/feature/stock/ItemModal";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import { StockInForm } from "@/components/feature/stock/StockInForm";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KpiCard } from "./KpiCard";
import { RecentBillsCard } from "./RecentBillsCard";
import { TopCustomersCard } from "./TopCustomersCard";
import { StockHealthCard } from "./StockHealthCard";
import dynamic from "next/dynamic";
import type { Bill, Customer } from "@/lib/types";

// Charts pull in recharts (~110 kB), which no other route needs. Load them on
// demand so it stays out of the initial dashboard bundle. Client-only (ssr:
// false) — the whole dashboard renders client-side behind the auth gate anyway.
// Doubles as the data-loading skeleton for each chart.
const ChartFallback = ({ h }: { h: number }) => (
  <div className="w-full animate-pulse rounded-xl bg-line-soft" style={{ height: h }} />
);
const SalesChart = dynamic(() => import("./SalesChart").then((m) => m.SalesChart), {
  ssr: false,
  loading: () => <ChartFallback h={160} />,
});
const TopItemsChart = dynamic(() => import("./TopItemsChart").then((m) => m.TopItemsChart), {
  ssr: false,
  loading: () => <ChartFallback h={140} />,
});
const CategoryChart = dynamic(() => import("./CategoryChart").then((m) => m.CategoryChart), {
  ssr: false,
  loading: () => <ChartFallback h={140} />,
});

const priorityBadge: Record<string, string> = {
  High: "badge-danger",
  Medium: "badge-warn",
  Low: "badge-success",
  Info: "badge-brown",
};

// Cache the last-fetched stats keyed by user + range so a user switch or a range
// change never shows stale data, and revisiting a range renders instantly.
let statsCache: { key: string; data: DashboardStats } | null = null;
// Remember the selected range across navigation within the session.
let rangeMemo: DateRange | null = null;

const rangeKey = (uid: string | undefined, r: DateRange) =>
  `${uid ?? "?"}|${r.from ?? ""}|${r.to ?? ""}`;

export function Dashboard() {
  const router = useRouter();
  const user = useCurrentUser();
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const lowStockAlert = useBakeryStore((s) => s.bakery.lowStockAlert);
  const expiringSoonDays = useBakeryStore((s) => s.bakery.expiringSoonDays);
  const toast = useUIStore((s) => s.toast);

  const [range, setRange] = useState<DateRange>(rangeMemo ?? last7Days());
  const [stats, setStats] = useState<DashboardStats | null>(
    statsCache && statsCache.key === rangeKey(user?.id, rangeMemo ?? last7Days())
      ? statsCache.data
      : null,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [stockInOpen, setStockInOpen] = useState(false);
  const [viewBill, setViewBill] = useState<Bill | null>(null);
  const [topCustomers, setTopCustomers] = useState<Customer[]>([]);
  const [custLoaded, setCustLoaded] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [statsRetryToken, setStatsRetryToken] = useState(0);

  const invalidRange = !!(range.from && range.to && range.from > range.to);

  // Sales analytics are aggregated server-side (bounded payload) rather than by
  // downloading every bill. Served from cache instantly on revisit, then
  // revalidated; item-derived views below stay reactive to the store. A failed
  // fetch surfaces as an explicit error (with retry) rather than leaving the
  // skeleton spinning forever or silently keeping stale/no data.
  useEffect(() => {
    let alive = true;
    rangeMemo = range;
    if (invalidRange) {
      return () => {
        alive = false;
      };
    }
    const key = rangeKey(user?.id, range);
    // Serve cache instantly if it matches this exact user+range, else show skeleton.
    if (statsCache && statsCache.key === key) {
      setStats(statsCache.data);
    } else {
      setStats(null);
    }
    setStatsError(false);
    fetchDashboardStats(range)
      .then((s) => {
        if (!alive) return;
        statsCache = { key, data: s };
        setStats(s);
      })
      .catch(() => {
        if (alive) setStatsError(true);
      });
    return () => {
      alive = false;
    };
  }, [user?.id, range, statsRetryToken, invalidRange]);

  // Top customers by lifetime spend — analytics-gated, computed on read. Fetched
  // separately from the aggregate stats payload. On failure `custError` is set
  // so the card can show a distinct "couldn't load" state instead of reading as
  // "this store has no customers."
  const [custError, setCustError] = useState(false);
  useEffect(() => {
    if (!hasPermission(user, "analytics")) return;
    let alive = true;
    fetchCustomers()
      .then((rows) => {
        if (!alive) return;
        setTopCustomers([...rows].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 5));
        setCustLoaded(true);
      })
      .catch(() => {
        if (alive) {
          setCustLoaded(true);
          setCustError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const doExport = async () => {
    const r = await exportExcelReport(await fetchReportData());
    toast(r.ok ? "Excel report downloaded" : r.error ?? "Export failed");
  };

  const openBill = async (id: string) => {
    const b = await fetchBill(id);
    if (b) setViewBill(b);
  };

  // The page shell renders immediately. `loading` is true only on a cold load
  // (no cached stats); on revisit `stats` is served from cache so the real data
  // shows instantly while it revalidates silently in the background.
  // Only shows skeletons while genuinely still in flight and nothing cached is
  // available yet — a failed fetch with no cache falls through to the error
  // banner below instead of spinning forever.
  const loading = !stats && !statsError;

  const lowStock = items.filter((i) => i.qty <= lowStockAlert).length;
  const expiredCount = items.filter(
    (i) => expiryStatus(i.earliestExpiry, i.tracksExpiry, expiringSoonDays, new Date()) === "expired",
  ).length;
  const expiringCount = items.filter(
    (i) => expiryStatus(i.earliestExpiry, i.tracksExpiry, expiringSoonDays, new Date()) === "expiring",
  ).length;

  const rangeSales = stats?.kpis.rangeSales ?? 0;
  const prevSales = stats?.kpis.prevSales ?? 0;
  const billsInRange = stats?.kpis.billsInRange ?? 0;
  const itemsSold = stats?.kpis.itemsSold ?? 0;
  const salesDelta =
    prevSales > 0
      ? Math.round(((rangeSales - prevSales) / prevSales) * 100)
      : rangeSales > 0
        ? 100
        : 0;
  const showDelta = stats !== null && prevSales > 0; // hidden for all-time / no prior period
  const avgBill = billsInRange > 0 ? rangeSales / billsInRange : 0;

  const recent = stats?.recentBills ?? [];
  const topItemsData = stats?.topItems ?? [];

  // Derivations are memoized on their real inputs so unrelated re-renders (modal
  // open/close, viewing a bill) don't recompute them or rebuild the array props
  // handed to the chart components.
  const chartData = useMemo(
    () => (stats ? bucketSeries(stats.weekly, range, new Date()) : []),
    [stats, range],
  );
  const categoryData = useMemo(
    () => stats?.categories.map((c) => ({ category: c.category, revenue: c.revenue })) ?? [],
    [stats],
  );
  const categoryPLData = useMemo(
    () =>
      stats
        ? categoryPLFrom(
            stats.categories.map((c) => ({ category: c.category, revenue: c.revenue, cogs: c.cogs ?? 0 })),
          )
        : [],
    [stats],
  );
  const health = useMemo(
    () =>
      stats
        ? stockHealthFrom(
            new Map(stats.soldByItem.map((s) => [s.itemId, s.qty])),
            stats.daySpan,
            items,
            lowStockAlert,
          )
        : [],
    [stats, items, lowStockAlert],
  );
  const recs = useMemo(
    () =>
      stats
        ? recommendationsFrom(
            {
              health,
              dowRevenue: stats.dowRevenue,
              hourCounts: stats.hourCounts,
              topEarner: stats.topEarner,
            },
            currency,
          )
        : [],
    [stats, health, currency],
  );
  return (
    <>
      <div className="card mb-3">
        <DateRangePicker value={range} onChange={setRange} />
        {invalidRange && (
          <p className="mt-2 text-xs font-semibold text-danger">&quot;From&quot; date must be before &quot;To&quot; date.</p>
        )}
      </div>

      {statsError && !stats && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#f0c9c0] bg-danger-bg px-3.5 py-3 text-[13px] font-semibold text-danger">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={16} /> Couldn&apos;t load sales analytics.
          </span>
          <button
            type="button"
            onClick={() => setStatsRetryToken((t) => t + 1)}
            className="shrink-0 rounded-full bg-danger px-3 py-1 text-[12px] font-bold text-white"
          >
            Retry
          </button>
        </div>
      )}

      {lowStock > 0 && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-[#ecd9a8] bg-warn-bg px-3.5 py-3 text-[13px] font-semibold text-warn">
          <AlertTriangle size={16} /> {lowStock} item{lowStock > 1 ? "s" : ""} running low on stock!
        </div>
      )}

      {(expiredCount > 0 || expiringCount > 0) && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-[#f0c9c0] bg-danger-bg px-3.5 py-3 text-[13px] font-semibold text-danger">
          <AlertTriangle size={16} />
          {expiredCount > 0 && `${expiredCount} item${expiredCount > 1 ? "s" : ""} expired`}
          {expiredCount > 0 && expiringCount > 0 && " · "}
          {expiringCount > 0 && `${expiringCount} expiring soon`}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KpiCard
          variant="hero"
          label="Sales"
          corner={
            showDelta && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                {salesDelta >= 0 ? "+" : ""}
                {salesDelta}%
              </span>
            )
          }
          value={
            loading ? (
              <div aria-hidden className="mt-2 h-8 w-24 animate-pulse rounded-md bg-white/25" />
            ) : (
              <div className="num mt-2 text-[28px] font-extrabold tracking-tight">
                {currency}
                {rangeSales.toFixed(0)}
              </div>
            )
          }
          subtitle={
            <div className="mt-0.5 text-[11.5px] opacity-70">
              {loading ? (
                <div aria-hidden className="mt-1 h-3 w-24 animate-pulse rounded bg-white/20" />
              ) : showDelta ? (
                <>
                  vs {currency}
                  {prevSales.toFixed(0)} prev period
                </>
              ) : (
                <>in selected range</>
              )}
            </div>
          }
        />

        <KpiCard
          label="Bills"
          value={
            loading ? (
              <Skeleton className="mt-2 h-8 w-16" />
            ) : (
              <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-ink">
                {billsInRange}
              </div>
            )
          }
          subtitle={
            <div className="mt-0.5 text-[11.5px] text-ink-light">
              {loading ? (
                <Skeleton className="mt-1 h-3 w-20" />
              ) : (
                <>
                  avg {currency}
                  {avgBill.toFixed(0)} / bill
                </>
              )}
            </div>
          }
        />

        <KpiCard
          label="Items Sold"
          value={
            loading ? (
              <Skeleton className="mt-2 h-8 w-16" />
            ) : (
              <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-ink">
                {itemsSold}
              </div>
            )
          }
          subtitle={<div className="mt-0.5 text-[11.5px] text-ink-light">across all categories</div>}
        />

        <KpiCard
          variant="warn"
          label="Low Stock"
          corner={<AlertTriangle size={16} />}
          value={
            <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-warn">
              {lowStock}
            </div>
          }
          subtitle={<div className="mt-0.5 text-[11.5px] text-warn">items need restock</div>}
        />
      </div>

      <div className="flex flex-col gap-4">
        {/* Hero row — primary chart + quick actions kept equal height so the
            cards beneath them line up across the two columns. */}
        <div className="grid gap-4 lg:grid-cols-[1fr_372px] lg:items-stretch">
          {hasPermission(user, "analytics") ? (
            <div className="card">
              <div className="card-header">
                <h3>{range.from === range.to && range.from ? "Sales" : "Sales over range"}</h3>
              </div>
              {loading ? <ChartFallback h={160} /> : <SalesChart data={chartData} currency={currency} />}
            </div>
          ) : (
            <div className="hidden lg:block" />
          )}

          <div className="card">
            <div className="card-header">
              <h3>Quick Actions</h3>
            </div>
            <div className="flex flex-col gap-2.5">
              {hasPermission(user, "sales") && (
                <button
                  className="btn-primary flex items-center justify-center gap-2 p-3.5 text-sm"
                  onClick={() => router.push("/bill")}
                >
                  <Receipt size={16} /> Create new bill
                </button>
              )}
              {hasPermission(user, "inventory") && (
                <button
                  className="btn-secondary flex items-center justify-center gap-2 p-3.5 text-sm"
                  onClick={() => setStockInOpen(true)}
                >
                  <Plus size={16} /> Add stock
                </button>
              )}
              {hasPermission(user, "inventory") && (
                <button
                  className="btn-secondary flex items-center justify-center gap-2 p-3.5 text-sm"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus size={16} /> Add Item
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Remaining content in two columns */}
        <div className="grid gap-4 lg:grid-cols-[1fr_372px] lg:items-start">
          {/* LEFT COLUMN */}
          <div className="flex min-w-0 flex-col gap-4">
            {hasPermission(user, "analytics") && (
              <>
                <div className="card">
                  <div className="card-header">
                    <h3>Top items</h3>
                  </div>
                {loading ? <ChartFallback h={140} /> : <TopItemsChart data={topItemsData} />}
              </div>

              <div className="card">
                <div className="card-header">
                  <h3>Sales &amp; profit by category</h3>
                </div>
                {loading ? (
                  <ChartFallback h={140} />
                ) : (
                  <CategoryChart data={categoryData} currency={currency} />
                )}
                {categoryPLData.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-left text-ink-muted">
                          <th className="pb-1.5 font-semibold">Category</th>
                          <th className="pb-1.5 text-right font-semibold">Revenue</th>
                          <th className="pb-1.5 text-right font-semibold">Profit</th>
                          <th className="pb-1.5 text-right font-semibold">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoryPLData.map((c) => (
                          <tr key={c.category} className="border-t border-line-soft">
                            <td className="py-1.5 font-semibold text-ink">{c.category}</td>
                            <td className="num py-1.5 text-right">
                              {currency}
                              {c.revenue.toFixed(0)}
                            </td>
                            <td
                              className={`num py-1.5 text-right font-bold ${
                                c.profit >= 0 ? "text-success" : "text-danger"
                              }`}
                            >
                              {currency}
                              {c.profit.toFixed(0)}
                            </td>
                            <td className="num py-1.5 text-right">
                              {c.marginPct !== null ? c.marginPct.toFixed(0) + "%" : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-header">
                  <h3 className="flex items-center gap-1.5">
                    <Lightbulb size={16} /> Business Boosters
                  </h3>
                </div>
                {loading
                  ? [0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 border-t border-line-soft py-2.5 first:border-t-0"
                      >
                        <Skeleton className="h-5 w-14 flex-shrink-0 rounded-full" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-2/3" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      </div>
                    ))
                  : recs.map((r, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2.5 border-t border-line-soft py-2.5 first:border-t-0"
                      >
                        <span className={`badge ${priorityBadge[r.priority]} flex-shrink-0`}>
                          {r.priority}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ink">{r.insight}</div>
                          <div className="text-[11.5px] text-ink-light">{r.detail}</div>
                        </div>
                      </div>
                    ))}
              </div>
            </>
          )}

          <RecentBillsCard loading={loading} recent={recent} currency={currency} onView={openBill} />
        </div>

          {/* RIGHT COLUMN */}
          <div className="flex min-w-0 flex-col gap-4">
            {hasPermission(user, "analytics") && (
              <TopCustomersCard
                loaded={custLoaded}
                error={custError}
                customers={topCustomers}
                currency={currency}
              />
            )}
            {hasPermission(user, "inventory") && (
              <StockHealthCard
                loading={loading}
                health={health}
                onRestock={() => setStockInOpen(true)}
              />
            )}
          </div>
        </div>
      </div>

      {addOpen && <ItemModal itemId={null} onClose={() => setAddOpen(false)} />}
      {viewBill && <ViewBillModal bill={viewBill} onClose={() => setViewBill(null)} />}
      {stockInOpen && (
        <Modal title="Add Stock" onClose={() => setStockInOpen(false)}>
          <StockInForm onSuccess={() => setStockInOpen(false)} />
        </Modal>
      )}
    </>
  );
}
