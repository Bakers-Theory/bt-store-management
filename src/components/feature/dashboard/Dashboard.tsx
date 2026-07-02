"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { isActiveBill, formatDate } from "@/lib/format";
import { exportExcelReport } from "@/lib/excel";
import { ItemModal } from "@/components/feature/stock/ItemModal";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import type { Bill } from "@/lib/types";

export function Dashboard() {
  const router = useRouter();
  const user = useCurrentUser();
  const items = useBakeryStore((s) => s.items);
  const bills = useBakeryStore((s) => s.bills);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const lowStockAlert = useBakeryStore((s) => s.bakery.lowStockAlert);
  const toast = useUIStore((s) => s.toast);

  const [addOpen, setAddOpen] = useState(false);
  const [viewBill, setViewBill] = useState<Bill | null>(null);

  const totalItems = items.length;
  const lowStockItems = items.filter((i) => i.qty <= lowStockAlert);
  const lowStock = lowStockItems.length;
  const activeBills = bills.filter(isActiveBill);
  const now = new Date();
  const todayBills = activeBills.filter(
    (b) => new Date(b.date).toDateString() === now.toDateString(),
  );
  const todayRevenue = todayBills.reduce((s, b) => s + b.total, 0);
  const recent = bills.slice(-5).reverse();

  const doExport = async () => {
    const { bakery, items, bills, logs } = useBakeryStore.getState();
    const r = await exportExcelReport({ bakery, items, bills, logs });
    toast(r.ok ? "📊 Excel report downloaded" : r.error ?? "Export failed");
  };

  return (
    <>
      {lowStock > 0 && (
        <div className="mb-3 rounded-xl border border-[#ffd700] bg-[#fff3cd] px-3.5 py-3 text-[13px] font-semibold text-warn">
          ⚠ {lowStock} item{lowStock > 1 ? "s" : ""} running low on stock!
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-line bg-white p-3.5 text-center">
          <div className="text-2xl font-bold text-brown">{totalItems}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-ink-muted">Total Items</div>
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5 text-center">
          <div className={`text-2xl font-bold ${lowStock > 0 ? "text-danger" : "text-success"}`}>
            {lowStock}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-ink-muted">Low Stock</div>
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5 text-center">
          <div className="text-2xl font-bold text-brown">{currency}{todayRevenue.toFixed(0)}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-ink-muted">Today&apos;s Revenue</div>
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5 text-center">
          <div className="text-2xl font-bold text-brown">{todayBills.length}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-ink-muted">Today&apos;s Bills</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Quick Actions</h3></div>
        <div className="grid grid-cols-2 gap-2.5">
          {hasPermission(user, "sales") && (
            <button className="btn-primary p-3.5 text-sm" onClick={() => router.push("/bill")}>🧾 New Bill</button>
          )}
          {hasPermission(user, "inventory") && (
            <button className="btn-secondary p-3.5 text-sm" onClick={() => setAddOpen(true)}>➕ Add Item</button>
          )}
          {hasPermission(user, "inventory") && (
            <button className="btn-secondary p-3.5 text-sm" onClick={() => router.push("/stock?tab=in")}>📥 Stock In</button>
          )}
          {hasPermission(user, "inventory") && (
            <button className="btn-secondary p-3.5 text-sm" onClick={() => router.push("/stock?tab=out")}>📤 Stock Out</button>
          )}
        </div>
        {hasPermission(user, "analytics") && (
          <button className="btn-success mt-2.5 w-full p-3 text-sm" onClick={doExport}>
            📊 Download Excel Report
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-header"><h3>Recent Bills</h3></div>
        {bills.length === 0 ? (
          <div className="p-5 text-center text-sm text-ink-muted">No bills yet</div>
        ) : (
          recent.map((b) => (
            <div
              key={b.id}
              className={`flex items-center justify-between border-b border-line py-2 ${b.status === "cancelled" ? "opacity-[0.55]" : ""}`}
            >
              <div>
                <div className="text-sm font-semibold">
                  #{b.billNo} {b.status === "cancelled" && <span className="badge badge-danger">Cancelled</span>}
                </div>
                <div className="text-[11px] text-ink-muted">
                  {b.customerName || "Walk-in"} · {formatDate(b.date)}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-[15px] font-bold text-brown ${b.status === "cancelled" ? "line-through" : ""}`}>
                  {currency}{b.total.toFixed(2)}
                </div>
                <button className="btn-sm btn-secondary mt-1" onClick={() => setViewBill(b)}>View</button>
              </div>
            </div>
          ))
        )}
      </div>

      {lowStockItems.length > 0 && (
        <div className="card">
          <div className="card-header"><h3>⚠ Low Stock Items</h3></div>
          {lowStockItems.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b border-line py-1.5">
              <div className="text-sm">{i.emoji || "📦"} {i.name}</div>
              <span className="badge badge-danger">{i.qty} {i.unit}</span>
            </div>
          ))}
        </div>
      )}

      {addOpen && <ItemModal itemId={null} onClose={() => setAddOpen(false)} />}
      {viewBill && <ViewBillModal bill={viewBill} onClose={() => setViewBill(null)} />}
    </>
  );
}
