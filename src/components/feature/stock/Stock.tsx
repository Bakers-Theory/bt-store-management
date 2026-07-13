"use client";

import { useEffect, useState } from "react";
import { Search, Plus, PackagePlus, PackageMinus, Package, Pencil, Trash2, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { expiryStatus } from "@/lib/expiry";
import { Modal } from "@/components/ui/Modal";
import { ItemModal } from "./ItemModal";
import { StockInForm } from "./StockInForm";
import { StockOutForm } from "./StockOutForm";

type Tab = "all" | "in" | "out";
type ModalState = { type: "add" | "edit" | "stockin" | "stockout"; id?: string } | null;

function statusOf(qty: number, lowStockAlert: number) {
  if (qty === 0) return { label: "Out", cls: "bg-danger-bg text-danger" };
  if (qty <= lowStockAlert) return { label: "Low", cls: "bg-warn-bg text-warn" };
  return { label: "In stock", cls: "bg-success-bg text-success" };
}

function ExpiryBadge({
  earliestExpiry, tracksExpiry, windowDays,
}: { earliestExpiry: string | null; tracksExpiry: boolean; windowDays: number }) {
  const s = expiryStatus(earliestExpiry, tracksExpiry, windowDays, new Date());
  if (s === "none" || s === "fresh") return null;
  const cls = s === "expired" ? "bg-danger-bg text-danger" : "bg-warn-bg text-warn";
  return (
    <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>
      {s === "expired" ? "Expired" : "Expiring"}
    </span>
  );
}

export function Stock({ initialTab = "all" }: { initialTab?: Tab }) {
  const items = useBakeryStore((s) => s.items);
  const lowStockAlert = useBakeryStore((s) => s.bakery.lowStockAlert);
  const expiringSoonDays = useBakeryStore((s) => s.bakery.expiringSoonDays);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const deleteItem = useBakeryStore((s) => s.deleteItem);
  const categories = useBakeryStore((s) => s.lists.categories);
  const toast = useUIStore((s) => s.toast);
  const requireOwnerAuth = useUIStore((s) => s.requireOwnerAuth);
  const isOpen = useBakeryStore((s) => s.bakery.isOpen);
  const refreshSettings = useBakeryStore((s) => s.refreshSettings);
  const user = useCurrentUser();
  // The Owner manages stock regardless of store status; everyone else is
  // locked out of inventory changes while the store is closed.
  const locked = !isOpen && user?.role !== "Owner";

  const [modal, setModal] = useState<ModalState>(
    initialTab === "in" && !locked
      ? { type: "stockin" }
      : initialTab === "out" && !locked
        ? { type: "stockout" }
        : null,
  );
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  // Best-effort: refresh store status so the view-only lock reflects reality.
  // Inventory changes are enforced server-side regardless.
  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const filtered = items.filter(
    (i) =>
      (category === "All" || i.category === category) &&
      i.name.toLowerCase().includes(search.toLowerCase()),
  );

  const totalItems = items.length;
  const totalUnits = items.reduce((s, i) => s + i.qty, 0);
  const stockValue = items.reduce((s, i) => s + i.price * i.qty, 0);
  const lowOrOut = items.filter((i) => i.qty <= lowStockAlert).length;

  const remove = (id: string, name: string) => {
    requireOwnerAuth(`delete item "${name}"`, async () => {
      await deleteItem(id);
      toast("Item deleted");
    });
  };

  const closeModal = () => setModal(null);

  return (
    <>
      {locked && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-[13px] font-bold text-danger">
          <span>🔒</span>
          Store is closed — inventory is view-only. Reopen the store to add or adjust stock.
        </div>
      )}
      {/* Stat tiles */}
      <div className="mb-[18px] grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="rounded-2xl border border-line bg-warm-white px-[18px] py-[15px]">
          <div className="text-xs font-semibold text-ink-muted">Total items</div>
          <div className="num mt-1 text-2xl font-extrabold">{totalItems}</div>
        </div>
        <div className="rounded-2xl border border-line bg-warm-white px-[18px] py-[15px]">
          <div className="text-xs font-semibold text-ink-muted">Units in stock</div>
          <div className="num mt-1 text-2xl font-extrabold">{totalUnits}</div>
        </div>
        <div className="rounded-2xl border border-line bg-warm-white px-[18px] py-[15px]">
          <div className="text-xs font-semibold text-ink-muted">Stock value</div>
          <div className="num mt-1 text-2xl font-extrabold">
            {currency}
            {stockValue.toFixed(2)}
          </div>
        </div>
        <div className="rounded-2xl border border-[#ecd9a8] bg-warn-bg px-[18px] py-[15px]">
          <div className="text-xs font-semibold text-warn">Low / out</div>
          <div className="num mt-1 text-2xl font-extrabold text-warn">{lowOrOut}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <span className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-ink-light">
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-line bg-warm-white py-[11px] pl-[38px] pr-10 text-sm outline-none"
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
        {!locked && (
          <>
            <button
              className="btn-primary flex items-center gap-1.5 whitespace-nowrap text-[13.5px]"
              onClick={() => setModal({ type: "add" })}
            >
              <Plus size={16} /> Add item
            </button>
            <button
              className="btn-secondary flex items-center gap-1.5 whitespace-nowrap text-[13.5px]"
              onClick={() => setModal({ type: "stockin" })}
            >
              <PackagePlus size={16} /> Add stock
            </button>
            <button
              className="btn-secondary flex items-center gap-1.5 whitespace-nowrap text-[13.5px]"
              onClick={() => setModal({ type: "stockout" })}
            >
              <PackageMinus size={16} /> Stock out
            </button>
          </>
        )}
      </div>

      {/* Category chips */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-0.5">
        {["All", ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 whitespace-nowrap rounded-full px-[15px] py-[7px] text-[13px] font-bold ${
              category === c
                ? "border border-brown bg-brown text-warm-white"
                : "border border-line bg-warm-white text-ink-muted"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-14 text-center text-ink-muted">
          <div className="mb-3 flex justify-center">
            <Package size={48} />
          </div>
          <p className="text-sm">No items found.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)] lg:block">
            <div className="grid grid-cols-[2.2fr_1fr_1fr_1fr_1fr_0.9fr] gap-3 bg-[#f8ecd8] px-5 py-[13px] text-[11.5px] font-bold uppercase tracking-[0.04em] text-[#8a6a3c]">
              <div>Item</div>
              <div>Category</div>
              <div className="text-right">Price</div>
              <div className="text-right">In stock</div>
              <div className="text-right">Status</div>
              <div />
            </div>
            {filtered.map((item) => {
              const st = statusOf(item.qty, lowStockAlert);
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[2.2fr_1fr_1fr_1fr_1fr_0.9fr] items-center gap-3 border-t border-line-soft px-5 py-[13px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-[22px]">{item.emoji || "📦"}</span>
                    <span className="truncate text-sm font-bold">{item.name}</span>
                    <ExpiryBadge
                      earliestExpiry={item.earliestExpiry}
                      tracksExpiry={item.tracksExpiry}
                      windowDays={expiringSoonDays}
                    />
                  </div>
                  <div className="text-[13px] font-semibold text-ink-muted">
                    {item.category || "General"}
                  </div>
                  <div className="num text-right text-[13.5px] font-bold">
                    {currency}
                    {item.price.toFixed(2)}
                  </div>
                  <div className="num text-right text-[13.5px] font-bold">
                    {item.qty} {item.unit}
                  </div>
                  <div className="text-right">
                    <span className={`inline-block rounded-full px-[11px] py-1 text-[11.5px] font-bold ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex justify-end gap-1.5">
                    {!locked && (
                      <>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-warm-white text-sm"
                          onClick={() => setModal({ type: "edit", id: item.id })}
                          aria-label={`Edit ${item.name}`}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-lg border-none bg-danger-bg text-sm text-danger"
                          onClick={() => remove(item.id, item.name)}
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Phone cards */}
          <div className="flex flex-col gap-2.5 lg:hidden">
            {filtered.map((item) => {
              const st = statusOf(item.qty, lowStockAlert);
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-[15px] border border-line bg-warm-white px-[15px] py-[13px]"
                >
                  <span className="text-[26px]">{item.emoji || "📦"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {item.name}
                      <ExpiryBadge
                        earliestExpiry={item.earliestExpiry}
                        tracksExpiry={item.tracksExpiry}
                        windowDays={expiringSoonDays}
                      />
                    </div>
                    <div className="num text-xs font-semibold text-ink-muted">
                      {currency}
                      {item.price.toFixed(2)} · {item.qty} {item.unit}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-[11px] py-1 text-[11.5px] font-bold ${st.cls}`}>
                    {st.label}
                  </span>
                  <div className="flex shrink-0 gap-1.5">
                    {!locked && (
                      <>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-warm-white text-sm"
                          onClick={() => setModal({ type: "edit", id: item.id })}
                          aria-label={`Edit ${item.name}`}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-lg border-none bg-danger-bg text-sm text-danger"
                          onClick={() => remove(item.id, item.name)}
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {modal && (modal.type === "add" || modal.type === "edit") && (
        <ItemModal itemId={modal.id ?? null} onClose={closeModal} />
      )}
      {modal && modal.type === "stockin" && (
        <Modal title="Add Stock" onClose={closeModal}>
          <StockInForm onSuccess={closeModal} />
        </Modal>
      )}
      {modal && modal.type === "stockout" && (
        <Modal title="Stock Out" onClose={closeModal}>
          <StockOutForm onSuccess={closeModal} />
        </Modal>
      )}
    </>
  );
}
