"use client";

import { useState } from "react";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { formatDateFull } from "@/lib/format";
import { tabCls } from "@/components/ui/tabClass";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import type { Bill, Log } from "@/lib/types";

export function History() {
  const user = useCurrentUser();
  const bills = useBakeryStore((s) => s.bills);
  const logs = useBakeryStore((s) => s.logs);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const cancelBill = useBakeryStore((s) => s.cancelBill);
  const deleteBill = useBakeryStore((s) => s.deleteBill);
  const toast = useUIStore((s) => s.toast);
  const requireOwnerAuth = useUIStore((s) => s.requireOwnerAuth);

  const canSales = hasPermission(user, "sales");
  const canInv = hasPermission(user, "inventory");
  const [tab, setTab] = useState<"bills" | "logs">(canSales ? "bills" : "logs");
  const [viewBill, setViewBill] = useState<Bill | null>(null);

  const doCancel = (b: Bill) => {
    if (b.status === "cancelled") {
      toast("Already cancelled");
      return;
    }
    if (!confirm(`Cancel Bill #${b.billNo}? Stock quantities will be restored.`)) return;
    const r = cancelBill(b.id, user?.name ?? "Unknown");
    if (r.ok) toast(`🚫 Bill #${r.billNo} cancelled`);
  };

  const doDelete = (b: Bill) => {
    requireOwnerAuth(`permanently delete Bill #${b.billNo}`, () => {
      const r = deleteBill(b.id, user?.name ?? "Unknown");
      if (r.ok) toast(`🗑 Bill #${r.billNo} deleted`);
    });
  };

  const logIcon = (t: Log["type"]) =>
    t === "in" ? "📥" : t === "out" ? "📤" : t === "cancel" ? "🚫" : t === "delete" ? "🗑" : "🧾";

  return (
    <>
      <div className="mb-4 flex rounded-xl bg-cream-dark p-[3px]">
        {canSales && (
          <button className={tabCls(tab === "bills")} onClick={() => setTab("bills")}>Bills</button>
        )}
        {canInv && (
          <button className={tabCls(tab === "logs")} onClick={() => setTab("logs")}>Stock Log</button>
        )}
      </div>

      {tab === "bills" && (
        bills.length === 0 ? (
          <div className="px-5 py-10 text-center text-ink-muted"><div className="mb-3 text-5xl">🧾</div><p className="text-sm">No bills generated yet</p></div>
        ) : (
          [...bills].reverse().map((b) => (
            <div key={b.id} className={`card ${b.status === "cancelled" ? "opacity-[0.65]" : ""}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[15px] font-bold">
                    #{b.billNo} {b.status === "cancelled" && <span className="badge badge-danger">Cancelled</span>}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {b.customerName || "Walk-in"} {b.customerPhone ? "· " + b.customerPhone : ""}
                  </div>
                  <div className="text-[11px] text-ink-light">{formatDateFull(b.date)}</div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {b.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
                  </div>
                  {b.status === "cancelled" && b.cancelledBy && (
                    <div className="mt-1 text-[11px] text-danger">Cancelled by {b.cancelledBy}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className={`text-[17px] font-bold text-brown ${b.status === "cancelled" ? "line-through" : ""}`}>
                    {currency}{b.total.toFixed(2)}
                  </div>
                  <div className="mt-1.5 flex flex-col gap-1">
                    <button className="btn-sm btn-secondary" onClick={() => setViewBill(b)}>🧾 View</button>
                    {b.status !== "cancelled" && (
                      <button className="cursor-pointer rounded-lg border-none bg-warn px-2.5 py-1.5 text-xs text-white" onClick={() => doCancel(b)}>🚫 Cancel</button>
                    )}
                    <button className="cursor-pointer rounded-lg border-none bg-danger px-2.5 py-1.5 text-xs text-white" onClick={() => doDelete(b)}>🗑 Delete</button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )
      )}

      {tab === "logs" && (
        logs.length === 0 ? (
          <div className="px-5 py-10 text-center text-ink-muted"><div className="mb-3 text-5xl">📋</div><p className="text-sm">No activity yet</p></div>
        ) : (
          [...logs].reverse().map((l) => (
            <div
              key={l.id}
              className={`mb-2 rounded-r-xl border-l-[3px] bg-white px-3 py-2 ${
                l.type === "in"
                  ? "border-l-success"
                  : l.type === "out" || l.type === "cancel" || l.type === "delete"
                    ? "border-l-danger"
                    : "border-l-line-strong"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">
                    {logIcon(l.type)}{" "}
                    {l.type === "bill" || l.type === "cancel" || l.type === "delete"
                      ? `Bill #${l.billNo}`
                      : `${l.itemName} (${l.type === "in" ? "+" : "-"}${l.qty})`}
                  </div>
                  {l.supplier && <div className="text-[11px] text-ink-muted">Supplier: {l.supplier}</div>}
                  {l.reason && <div className="text-[11px] text-ink-muted">Reason: {l.reason}</div>}
                  {l.notes && <div className="text-[11px] text-ink-muted">{l.notes}</div>}
                  {l.items && <div className="text-[11px] text-ink-muted">{l.items}</div>}
                </div>
                <div className="text-right">
                  {l.total != null && <div className="font-bold text-brown">{currency}{l.total.toFixed(2)}</div>}
                  <div className="text-[11px] text-ink-muted">{formatDateFull(l.date)}</div>
                </div>
              </div>
            </div>
          ))
        )
      )}

      {viewBill && <ViewBillModal bill={viewBill} onClose={() => setViewBill(null)} />}
    </>
  );
}
