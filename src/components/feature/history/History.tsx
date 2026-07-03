"use client";

import { useState } from "react";
import {
  Ban,
  ClipboardList,
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
import { formatDateFull } from "@/lib/format";
import { tabCls } from "@/components/ui/tabClass";
import { ViewBillModal } from "@/components/feature/bill/ViewBillModal";
import type { Bill, Log } from "@/lib/types";

type StatusFilter = "All" | "Active" | "Cancelled";

const initials = (name: string) => {
  const n = (name || "Walk-in").trim();
  if (!n || n.toLowerCase() === "walk-in") return "W";
  return n
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
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
  if (l.supplier) parts.push(`Supplier: ${l.supplier}`);
  if (l.reason) parts.push(`Reason: ${l.reason}`);
  if (l.notes) parts.push(l.notes);
  if (l.items) parts.push(l.items);
  return parts.join(" · ");
};

export function History() {
  const user = useCurrentUser();
  const bills = useBakeryStore((s) => s.bills);
  const logs = useBakeryStore((s) => s.logs);
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

  const itemEmoji = (itemId?: string) => items.find((i) => i.id === itemId)?.emoji || "📦";

  const doCancel = async (b: Bill) => {
    if (b.status === "cancelled") {
      toast("Already cancelled");
      return;
    }
    if (!confirm(`Cancel Bill #${b.billNo}? Stock quantities will be restored.`)) return;
    const r = await cancelBill(b.id, user?.name ?? "Unknown");
    if (r.ok) toast(`Bill #${r.billNo} cancelled`);
    else if (r.error) toast(r.error);
  };

  const doDelete = (b: Bill) => {
    requireOwnerAuth(`permanently delete Bill #${b.billNo}`, async () => {
      const r = await deleteBill(b.id, user?.name ?? "Unknown");
      if (r.ok) toast(`Bill #${r.billNo} deleted`);
      else if (r.error) toast(r.error);
    });
  };

  const q = search.trim().toLowerCase();
  const filteredBills = [...bills]
    .filter((b) => {
      if (statusFilter !== "All" && b.status !== statusFilter.toLowerCase()) return false;
      if (!q) return true;
      const name = (b.customerName || "Walk-in").toLowerCase();
      return name.includes(q) || String(b.billNo).includes(q);
    })
    .reverse();

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

          {filteredBills.length === 0 ? (
            <div className="px-5 py-10 text-center text-ink-muted">
              <div className="mb-3 flex justify-center">
                <ReceiptText size={48} />
              </div>
              <p className="text-sm">{bills.length === 0 ? "No bills generated yet" : "No bills match your search"}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
              {filteredBills.map((b) => {
                const cancelled = b.status === "cancelled";
                return (
                  <div key={b.id} className="flex flex-wrap items-center gap-3.5 border-t border-line-soft px-5 py-3.5 first:border-t-0">
                    <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#f4e7d2] text-[13px] font-bold text-brown">
                      {initials(b.customerName)}
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
                          className="inline-flex cursor-pointer items-center justify-center rounded-lg border-none bg-warn px-2.5 py-1.5 text-xs text-white"
                          onClick={() => doCancel(b)}
                          aria-label="Cancel bill"
                        >
                          <Ban size={16} />
                        </button>
                      )}
                      <button
                        className="inline-flex cursor-pointer items-center justify-center rounded-lg border-none bg-danger px-2.5 py-1.5 text-xs text-white"
                        onClick={() => doDelete(b)}
                        aria-label="Delete bill"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "logs" && (
        logs.length === 0 ? (
          <div className="px-5 py-10 text-center text-ink-muted">
            <div className="mb-3 flex justify-center">
              <ClipboardList size={48} />
            </div>
            <p className="text-sm">No activity yet</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
            {[...logs].reverse().map((l) => {
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
        )
      )}

      {viewBill && <ViewBillModal bill={viewBill} onClose={() => setViewBill(null)} />}
    </>
  );
}
