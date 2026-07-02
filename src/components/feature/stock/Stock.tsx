"use client";

import { useState } from "react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { tabCls } from "@/components/ui/tabClass";
import { ItemModal } from "./ItemModal";
import { StockInForm } from "./StockInForm";
import { StockOutForm } from "./StockOutForm";

type Tab = "all" | "in" | "out";

export function Stock({ initialTab = "all" }: { initialTab?: Tab }) {
  const items = useBakeryStore((s) => s.items);
  const lowStockAlert = useBakeryStore((s) => s.bakery.lowStockAlert);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const deleteItem = useBakeryStore((s) => s.deleteItem);
  const toast = useUIStore((s) => s.toast);
  const requireOwnerAuth = useUIStore((s) => s.requireOwnerAuth);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState("");
  // null = closed; { id } where id null = add, string = edit
  const [modal, setModal] = useState<{ id: string | null } | null>(null);

  const filtered = items.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
  );

  const remove = (id: string, name: string) => {
    requireOwnerAuth(`delete item "${name}"`, () => {
      deleteItem(id);
      toast("🗑 Item deleted");
    });
  };

  return (
    <>
      <div className="mb-4 flex rounded-xl bg-cream-dark p-[3px]">
        <button className={tabCls(tab === "all")} onClick={() => setTab("all")}>All Items</button>
        <button className={tabCls(tab === "in")} onClick={() => setTab("in")}>Stock In</button>
        <button className={tabCls(tab === "out")} onClick={() => setTab("out")}>Stock Out</button>
      </div>

      {tab === "all" && (
        <>
          <div className="relative mb-3">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-ink-light">🔍</span>
            <input
              type="text"
              placeholder="Search items..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="btn-primary mb-3 w-full"
            onClick={() => setModal({ id: null })}
          >
            ➕ Add New Item
          </button>

          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-ink-muted">
              <div className="mb-3 text-5xl">📦</div>
              <p className="text-sm">No items found. Add your first item!</p>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="mb-2 flex items-center gap-3 rounded-xl border border-line bg-white p-3"
              >
                <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-cream-dark text-xl">
                  {item.emoji || "📦"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{item.name}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {currency}
                    {item.price.toFixed(2)} · {item.category || "General"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-lg font-bold ${item.qty <= lowStockAlert ? "text-danger" : "text-success"}`}>
                    {item.qty}
                  </div>
                  <div className="text-[11px] text-ink-muted">{item.unit}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <button className="btn-sm btn-secondary" onClick={() => setModal({ id: item.id })}>✏</button>
                  <button
                    className="cursor-pointer rounded-lg border-none bg-danger px-2.5 py-1.5 text-xs text-white"
                    onClick={() => remove(item.id, item.name)}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {tab === "in" && <StockInForm />}
      {tab === "out" && <StockOutForm />}

      {modal && <ItemModal itemId={modal.id} onClose={() => setModal(null)} />}
    </>
  );
}
