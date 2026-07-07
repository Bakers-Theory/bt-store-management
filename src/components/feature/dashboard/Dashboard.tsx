"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Lightbulb, Package, Download, Receipt, Plus, Users } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { exportExcelReport } from "@/lib/excel";
import {
  fetchDashboardStats,
  fetchReportData,
  fetchBill,
  fetchCustomers,
  type DashboardStats,
} from "@/lib/supabase-data";
import {
  weeklyBuckets,
  categoryPLFrom,
  stockHealthFrom,
  recommendationsFrom,
  type StockVerdict,
} from "@/lib/analytics";
import { expiryStatus } from "@/lib/expiry";
import { ItemModal } from "@/components/feature/stock/ItemModal";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import { StockInForm } from "@/components/feature/stock/StockInForm";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
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

const verdictBadge: Record<StockVerdict, string> = {
  "Reorder now": "badge-danger",
  "Reorder soon": "badge-warn",
  "Dead stock": "badge-brown",
  "Slow-moving": "badge-warn",
  Healthy: "badge-success",
};

const verdictRank: Record<StockVerdict, number> = {
  "Reorder now": 0,
  "Dead stock": 1,
  "Reorder soon": 2,
  "Slow-moving": 3,
  Healthy: 4,
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// Cache the last-fetched stats (keyed by user, so a user switch on the same tab
// never shows the previous user's data) so navigating back to the dashboard
// renders instantly while it revalidates in the background.
let statsCache: { uid: string; data: DashboardStats } | null = null;

export function Dashboard() {
  const router = useRouter();
  const user = useCurrentUser();
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const lowStockAlert = useBakeryStore((s) => s.bakery.lowStockAlert);
  const expiringSoonDays = useBakeryStore((s) => s.bakery.expiringSoonDays);
  const toast = useUIStore((s) => s.toast);

  const [stats, setStats] = useState<DashboardStats | null>(
    statsCache && statsCache.uid === user?.id ? statsCache.data : null,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [stockInOpen, setStockInOpen] = useState(false);
  const [viewBill, setViewBill] = useState<Bill | null>(null);
  const [topCustomers, setTopCustomers] = useState<Customer[]>([]);
  const [custLoaded, setCustLoaded] = useState(false);

  // Sales analytics are aggregated server-side (bounded payload) rather than by
  // downloading every bill. Served from cache instantly on revisit, then
  // revalidated; item-derived views below stay reactive to the store.
  useEffect(() => {
    let alive = true;
    fetchDashboardStats()
      .then((s) => {
        if (!alive) return;
        if (user?.id) statsCache = { uid: user.id, data: s };
        setStats(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.id]);

  // Top customers by lifetime spend — analytics-gated, computed on read. Fetched
  // separately from the aggregate stats payload; failures degrade silently.
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
        if (alive) setCustLoaded(true);
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
  const loading = !stats;

  const lowStock = items.filter((i) => i.qty <= lowStockAlert).length;
  const expiredCount = items.filter(
    (i) => expiryStatus(i.earliestExpiry, i.tracksExpiry, expiringSoonDays, new Date()) === "expired",
  ).length;
  const expiringCount = items.filter(
    (i) => expiryStatus(i.earliestExpiry, i.tracksExpiry, expiringSoonDays, new Date()) === "expiring",
  ).length;

  const todaySales = stats?.kpis.todaySales ?? 0;
  const yesterdaySales = stats?.kpis.yesterdaySales ?? 0;
  const billsToday = stats?.kpis.billsToday ?? 0;
  const itemsSold = stats?.kpis.itemsSoldToday ?? 0;
  const salesDelta =
    yesterdaySales > 0
      ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
      : todaySales > 0
        ? 100
        : 0;
  const avgBill = billsToday > 0 ? todaySales / billsToday : 0;

  const recent = stats?.recentBills ?? [];
  const topItemsData = stats?.topItems ?? [];

  // Derivations are memoized on their real inputs so unrelated re-renders (modal
  // open/close, viewing a bill) don't recompute them or rebuild the array props
  // handed to the chart components.
  const chartData = useMemo(
    () => (stats ? weeklyBuckets(stats.weekly, new Date()) : []),
    [stats],
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
  const attention = useMemo(
    () =>
      health
        .filter((s) => s.verdict !== "Healthy")
        .sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict]),
    [health],
  );

  return (
    <>
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
        <div className="rounded-[18px] bg-gradient-to-br from-brown to-brown-dark p-[18px_20px] text-warm-white shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold opacity-80">Today&apos;s Sales</span>
            {!loading && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                {salesDelta >= 0 ? "+" : ""}
                {salesDelta}%
              </span>
            )}
          </div>
          {loading ? (
            <div aria-hidden className="mt-2 h-8 w-24 animate-pulse rounded-md bg-white/25" />
          ) : (
            <div className="num mt-2 text-[28px] font-extrabold tracking-tight">
              {currency}
              {todaySales.toFixed(0)}
            </div>
          )}
          <div className="mt-0.5 text-[11.5px] opacity-70">
            {loading ? (
              <div aria-hidden className="mt-1 h-3 w-24 animate-pulse rounded bg-white/20" />
            ) : (
              <>
                vs {currency}
                {yesterdaySales.toFixed(0)} yesterday
              </>
            )}
          </div>
        </div>

        <div className="rounded-[18px] border border-line bg-warm-white p-[18px_20px]">
          <div className="text-[12.5px] font-semibold text-ink-muted">Bills Today</div>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-ink">
              {billsToday}
            </div>
          )}
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
        </div>

        <div className="rounded-[18px] border border-line bg-warm-white p-[18px_20px]">
          <div className="text-[12.5px] font-semibold text-ink-muted">Items Sold</div>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-ink">
              {itemsSold}
            </div>
          )}
          <div className="mt-0.5 text-[11.5px] text-ink-light">across all categories</div>
        </div>

        <div className="rounded-[18px] border border-[#ecd9a8] bg-warn-bg p-[18px_20px]">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-warn">Low Stock</span>
            <AlertTriangle size={16} />
          </div>
          <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-warn">
            {lowStock}
          </div>
          <div className="mt-0.5 text-[11.5px] text-warn">items need restock</div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Hero row — primary chart + quick actions kept equal height so the
            cards beneath them line up across the two columns. */}
        <div className="grid gap-4 lg:grid-cols-[1fr_372px] lg:items-stretch">
          {hasPermission(user, "analytics") ? (
            <div className="card">
              <div className="card-header">
                <h3>Sales this week</h3>
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

          <div className="card">
            <div className="card-header">
              <h3>Recent Bills</h3>
            </div>
            {loading ? (
              [0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-b-0">
                  <Skeleton className="h-9 w-9 rounded-[10px]" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-8 w-14" />
                </div>
              ))
            ) : recent.length === 0 ? (
              <div className="p-5 text-center text-sm text-ink-muted">No bills yet</div>
            ) : (
              recent.map((b) => (
                <div
                  key={b.id}
                  className={`flex items-center gap-3 border-b border-line-soft py-2.5 last:border-b-0 ${
                    b.status === "cancelled" ? "opacity-[0.55]" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-line-soft text-[13px] font-bold text-brown">
                    {initials(b.customerName || "Walk-in")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {b.customerName || "Walk-in"}{" "}
                      {b.status === "cancelled" && (
                        <span className="badge badge-danger">Cancelled</span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-ink-light">
                      #{b.billNo} · {formatDate(b.date)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`num text-[14px] font-extrabold ${b.status === "cancelled" ? "line-through" : ""}`}
                    >
                      {currency}
                      {b.total.toFixed(2)}
                    </div>
                    <button className="btn-sm btn-secondary mt-1" onClick={() => openBill(b.id)}>
                      View
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

          {/* RIGHT COLUMN */}
          <div className="flex min-w-0 flex-col gap-4">
            {hasPermission(user, "analytics") && (
              <div className="card">
                <div className="card-header">
                  <h3 className="flex items-center gap-1.5">
                    <Users size={16} /> Top customers
                  </h3>
                </div>
                {!custLoaded ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0">
                      <Skeleton className="h-7 w-7 rounded-full" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                      <Skeleton className="h-4 w-12" />
                    </div>
                  ))
                ) : topCustomers.length === 0 ? (
                  <div className="p-3 text-center text-[12.5px] text-ink-muted">No customers yet</div>
                ) : (
                  topCustomers.map((c, i) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0"
                    >
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-line-soft text-[12px] font-bold text-brown">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold text-ink">
                          {c.name || c.phone}
                        </div>
                        <div className="text-[11.5px] text-ink-light">
                          {c.visitCount} visit{c.visitCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="num text-[14px] font-extrabold text-ink">
                        {currency}
                        {c.totalSpend.toFixed(0)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {hasPermission(user, "inventory") && (
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h3 className="flex items-center gap-1.5">
                  <Package size={16} /> Stock Health
                </h3>
                {attention.length > 0 && (
                  <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-[11px] font-bold text-warn">
                    {attention.length}
                  </span>
                )}
              </div>
              {loading ? (
                [0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))
              ) : attention.length === 0 ? (
                <div className="p-3 text-center text-[12.5px] text-ink-muted">
                  All items are healthy
                </div>
              ) : (
                attention.map((s) => {
                  const needsRestock =
                    s.verdict === "Reorder now" || s.verdict === "Reorder soon";
                  return (
                    <div
                      key={s.item.id}
                      className="flex items-center gap-2.5 border-t border-line-soft py-2.5 first:border-t-0"
                    >
                      <div className="text-[22px]">{s.item.emoji || "📦"}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-bold">{s.item.name}</span>
                          <span className={`badge ${verdictBadge[s.verdict]} flex-shrink-0`}>
                            {s.verdict}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-ink-light">
                          {s.item.qty} {s.item.unit} left
                          {s.daysCover !== null && ` · ${s.daysCover.toFixed(0)}d cover`}
                        </div>
                      </div>
                      {needsRestock && (
                        <button
                          className="rounded-[9px] bg-line-soft px-3 py-1.5 text-[12px] font-bold text-brown"
                          onClick={() => setStockInOpen(true)}
                        >
                          Restock
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
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
