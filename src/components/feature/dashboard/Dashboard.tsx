"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { isActiveBill, formatDate } from "@/lib/format";
import { exportExcelReport } from "@/lib/excel";
import {
  weeklySales,
  topItems,
  categoryRevenue,
  categoryPL,
  stockHealth,
  recommendations,
  type StockVerdict,
} from "@/lib/analytics";
import { ItemModal } from "@/components/feature/stock/ItemModal";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import { StockInForm } from "@/components/feature/stock/StockInForm";
import { Modal } from "@/components/ui/Modal";
import { SalesChart } from "./SalesChart";
import { TopItemsChart } from "./TopItemsChart";
import { CategoryChart } from "./CategoryChart";
import type { Bill } from "@/lib/types";

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

export function Dashboard() {
  const router = useRouter();
  const user = useCurrentUser();
  const items = useBakeryStore((s) => s.items);
  const bills = useBakeryStore((s) => s.bills);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const lowStockAlert = useBakeryStore((s) => s.bakery.lowStockAlert);
  const toast = useUIStore((s) => s.toast);

  const [addOpen, setAddOpen] = useState(false);
  const [stockInOpen, setStockInOpen] = useState(false);
  const [viewBill, setViewBill] = useState<Bill | null>(null);

  const lowStockItems = items.filter((i) => i.qty <= lowStockAlert);
  const lowStock = lowStockItems.length;

  const activeBills = bills.filter(isActiveBill);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayBills = activeBills.filter(
    (b) => new Date(b.date).toDateString() === now.toDateString(),
  );
  const yesterdayBills = activeBills.filter(
    (b) => new Date(b.date).toDateString() === yesterday.toDateString(),
  );

  const todaySales = todayBills.reduce((s, b) => s + b.total, 0);
  const yesterdaySales = yesterdayBills.reduce((s, b) => s + b.total, 0);
  const salesDelta =
    yesterdaySales > 0
      ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
      : todaySales > 0
        ? 100
        : 0;

  const billsToday = todayBills.length;
  const avgBill = billsToday > 0 ? todaySales / billsToday : 0;
  const itemsSold = todayBills.reduce(
    (s, b) => s + b.items.reduce((is, line) => is + line.qty, 0),
    0,
  );

  const recent = bills.slice(-5).reverse();

  const chartData = weeklySales(bills, now);
  const topItemsData = topItems(bills);
  const categoryData = categoryRevenue(bills, items);
  const categoryPLData = categoryPL(bills, items);
  const recs = recommendations(bills, items, lowStockAlert, currency);
  const attention = stockHealth(bills, items, lowStockAlert)
    .filter((s) => s.verdict !== "Healthy")
    .sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict]);

  const doExport = async () => {
    const { bakery, items, bills, logs } = useBakeryStore.getState();
    const r = await exportExcelReport({ bakery, items, bills, logs });
    toast(r.ok ? "📊 Excel report downloaded" : r.error ?? "Export failed");
  };

  return (
    <>
      {lowStock > 0 && (
        <div className="mb-3 rounded-xl border border-[#ecd9a8] bg-warn-bg px-3.5 py-3 text-[13px] font-semibold text-warn">
          ⚠ {lowStock} item{lowStock > 1 ? "s" : ""} running low on stock!
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="rounded-[18px] bg-gradient-to-br from-brown to-brown-dark p-[18px_20px] text-warm-white shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold opacity-80">Today&apos;s Sales</span>
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
              {salesDelta >= 0 ? "+" : ""}
              {salesDelta}%
            </span>
          </div>
          <div className="num mt-2 text-[28px] font-extrabold tracking-tight">
            {currency}
            {todaySales.toFixed(0)}
          </div>
          <div className="mt-0.5 text-[11.5px] opacity-70">
            vs {currency}
            {yesterdaySales.toFixed(0)} yesterday
          </div>
        </div>

        <div className="rounded-[18px] border border-line bg-warm-white p-[18px_20px]">
          <div className="text-[12.5px] font-semibold text-ink-muted">Bills Today</div>
          <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-ink">
            {billsToday}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-light">
            avg {currency}
            {avgBill.toFixed(0)} / bill
          </div>
        </div>

        <div className="rounded-[18px] border border-line bg-warm-white p-[18px_20px]">
          <div className="text-[12.5px] font-semibold text-ink-muted">Items Sold</div>
          <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-ink">
            {itemsSold}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-light">across all categories</div>
        </div>

        <div className="rounded-[18px] border border-[#ecd9a8] bg-warn-bg p-[18px_20px]">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-warn">Low Stock</span>
            <span>⚠</span>
          </div>
          <div className="num mt-2 text-[28px] font-extrabold tracking-tight text-warn">
            {lowStock}
          </div>
          <div className="mt-0.5 text-[11.5px] text-warn">items need restock</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_372px]">
        {/* LEFT COLUMN */}
        <div className="flex min-w-0 flex-col gap-4">
          {hasPermission(user, "analytics") && (
            <>
              <div className="card">
                <div className="card-header">
                  <h3>Sales this week</h3>
                </div>
                <SalesChart data={chartData} currency={currency} />
              </div>

              <div className="card">
                <div className="card-header">
                  <h3>Top items</h3>
                </div>
                <TopItemsChart data={topItemsData} />
              </div>

              <div className="card">
                <div className="card-header">
                  <h3>Sales &amp; profit by category</h3>
                </div>
                <CategoryChart data={categoryData} currency={currency} />
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
                  <h3>💡 Business Boosters</h3>
                </div>
                {recs.map((r, idx) => (
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

              <button className="btn-success w-full p-3 text-sm" onClick={doExport}>
                📊 Download Excel Report
              </button>
            </>
          )}

          <div className="card">
            <div className="card-header">
              <h3>Recent Bills</h3>
            </div>
            {bills.length === 0 ? (
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
                    <button className="btn-sm btn-secondary mt-1" onClick={() => setViewBill(b)}>
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
          <div className="card">
            <div className="card-header">
              <h3>Quick Actions</h3>
            </div>
            <div className="flex flex-col gap-2.5">
              {hasPermission(user, "sales") && (
                <button className="btn-primary p-3.5 text-sm" onClick={() => router.push("/bill")}>
                  🧾 Create new bill
                </button>
              )}
              {hasPermission(user, "inventory") && (
                <button
                  className="btn-secondary p-3.5 text-sm"
                  onClick={() => setStockInOpen(true)}
                >
                  ➕ Add stock
                </button>
              )}
              {hasPermission(user, "inventory") && (
                <button className="btn-secondary p-3.5 text-sm" onClick={() => setAddOpen(true)}>
                  📦 Add Item
                </button>
              )}
            </div>
          </div>

          {hasPermission(user, "inventory") && (
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h3>📦 Stock Health</h3>
                {attention.length > 0 && (
                  <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-[11px] font-bold text-warn">
                    {attention.length}
                  </span>
                )}
              </div>
              {attention.length === 0 ? (
                <div className="p-3 text-center text-[12.5px] text-ink-muted">
                  All items are healthy 🎉
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
