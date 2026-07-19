"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LayoutGrid, List, Loader2, Phone, Printer, Receipt as ReceiptIcon, ShoppingBasket, User, UserCheck, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { computeTotals } from "@/lib/bill";
import { expiryStatus } from "@/lib/expiry";
import { formatDate } from "@/lib/format";
import { fetchCustomerByPhone } from "@/lib/supabase-data";
import { Modal } from "@/components/ui/Modal";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Receipt } from "./Receipt";
import type { Bill as BillType, BillLine, Customer, Item, PaymentMethod } from "@/lib/types";

// Sellable stock for an item: expired batches are never sold (bill generation
// consumes fresh batches only), so the bill page ignores them. Returns the
// non-expired quantity and the soonest non-expired expiry date (for display).
function freshInfo(item: Item, windowDays: number, today: Date) {
  const fresh = item.batches.filter(
    (b) => expiryStatus(b.expiryDate, item.tracksExpiry, windowDays, today) !== "expired",
  );
  const qty = fresh.reduce((n, b) => n + b.qty, 0);
  const dates = fresh.map((b) => b.expiryDate).filter((d): d is string => !!d);
  const earliestExpiry = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  return { qty, earliestExpiry };
}

function ExpiryBadge({
  earliestExpiry, tracksExpiry, windowDays, className = "ml-1.5",
}: {
  earliestExpiry: string | null; tracksExpiry: boolean; windowDays: number; className?: string;
}) {
  const s = expiryStatus(earliestExpiry, tracksExpiry, windowDays, new Date());
  if (s === "none" || s === "fresh") return null;
  const cls = s === "expired" ? "bg-danger-bg text-danger" : "bg-warn-bg text-warn";
  return (
    <span className={`${className} rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>
      {s === "expired" ? "Expired" : "Expiring"}
    </span>
  );
}

export function Bill() {
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const taxRate = useBakeryStore((s) => s.bakery.taxRate);
  const expiringSoonDays = useBakeryStore((s) => s.bakery.expiringSoonDays);
  const generateBill = useBakeryStore((s) => s.generateBill);
  const categories = useBakeryStore((s) => s.lists.categories);
  const toast = useUIStore((s) => s.toast);
  const requestPrint = useUIStore((s) => s.requestPrint);
  const currentUser = useCurrentUser();
  const isOpen = useBakeryStore((s) => s.bakery.isOpen);
  const refreshSettings = useBakeryStore((s) => s.refreshSettings);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [cartOpen, setCartOpen] = useState(false); // mobile bottom-sheet expansion
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [payment, setPayment] = useState<PaymentMethod>("Cash");
  const [cashReceived, setCashReceived] = useState("");
  const [clearArmed, setClearArmed] = useState(false);
  const [discount, setDiscount] = useState("");
  const [phoneErr, setPhoneErr] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [returning, setReturning] = useState<Customer | null>(null);
  const [generating, setGenerating] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [receipt, setReceipt] = useState<BillType | null>(null);

  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const discountPct = Math.min(100, Math.max(0, parseFloat(discount) || 0));
  const { subtotal, discount: discountAmt, tax, total } = computeTotals(lines, taxRate, discountPct);
  const cartCount = lines.reduce((n, l) => n + l.qty, 0);
  const changeDue = (parseFloat(cashReceived) || 0) - total;

  // Why the Generate button is disabled — shown inline so it's never a silent
  // dead-end (a disabled button can't fire its own click handler).
  const disabledReason = !isOpen
    ? "Store is closed — billing is paused"
    : customer.name.trim() === ""
      ? "Enter a customer name to generate the bill"
      : customer.phone.length > 0 && customer.phone.length !== 10
        ? "Phone number must be exactly 10 digits"
        : "";

  // Each row carries its fresh (non-expired) qty + earliest fresh expiry.
  // Products with no fresh stock (out of stock, or only expired batches) are
  // dropped — they can't be sold.
  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    const today = new Date();
    return items
      .filter(
        (i) =>
          (category === "All" || i.category === category) &&
          i.name.toLowerCase().includes(q),
      )
      .map((item) => ({ item, ...freshInfo(item, expiringSoonDays, today) }))
      .filter((row) => row.qty > 0);
  }, [items, search, category, expiringSoonDays]);

  const cartQtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) map.set(l.itemId, l.qty);
    return map;
  }, [lines]);

  // Sellable (non-expired) stock per item, for capping cart quantities so a
  // cashier can't bill more than exists (the server would clamp silently).
  const freshQtyById = useMemo(() => {
    const today = new Date();
    const map = new Map<string, number>();
    for (const i of items) map.set(i.id, freshInfo(i, expiringSoonDays, today).qty);
    return map;
  }, [items, expiringSoonDays]);

  // Best-effort: pull the latest store status so a biller sees an accurate
  // Open/Closed state. Bill creation is enforced server-side regardless.
  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  // Autofill on repeat billing: once a full 10-digit phone is entered, look the
  // customer up (debounced, best-effort). On a hit, prefill an empty name field
  // and flag the returning customer. Never blocks bill generation.
  useEffect(() => {
    if (customer.phone.length !== 10) {
      setReturning(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const found = await fetchCustomerByPhone(customer.phone);
      if (!alive || !found) return;
      setReturning(found);
      setCustomer((c) =>
        c.phone === found.phone && c.name.trim() === "" ? { ...c, name: found.name } : c,
      );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [customer.phone]);

  const addToCart = (item: Item) => {
    const max = freshQtyById.get(item.id) ?? 0;
    if ((cartQtyById.get(item.id) ?? 0) >= max) {
      toast(`Only ${max} ${item.unit} of ${item.name} in stock`, "error");
      return;
    }
    setLines((prev) => {
      const idx = prev.findIndex((bi) => bi.itemId === item.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          itemId: item.id,
          name: item.name,
          emoji: item.emoji,
          imageUrl: item.imageUrl,
          unit: item.unit,
          qty: 1,
          price: item.price,
          costPrice: item.costPrice || 0,
        },
      ];
    });
  };

  const removeFromCart = (item: Item) =>
    setLines((prev) => {
      const idx = prev.findIndex((bi) => bi.itemId === item.id);
      if (idx < 0) return prev;
      if (prev[idx].qty <= 1) return prev.filter((_, i) => i !== idx);
      return prev.map((bi, i) => (i === idx ? { ...bi, qty: bi.qty - 1 } : bi));
    });

  const inc = (idx: number) => {
    const line = lines[idx];
    if (!line) return;
    const max = freshQtyById.get(line.itemId) ?? 0;
    if (line.qty >= max) {
      toast(`Only ${max} ${line.unit} of ${line.name} in stock`, "error");
      return;
    }
    setLines((prev) => prev.map((bi, i) => (i === idx ? { ...bi, qty: bi.qty + 1 } : bi)));
  };

  const dec = (idx: number) =>
    setLines((prev) => {
      const line = prev[idx];
      if (line.qty <= 1) return prev.filter((_, i) => i !== idx);
      return prev.map((bi, i) => (i === idx ? { ...bi, qty: bi.qty - 1 } : bi));
    });

  // Two-step to prevent a mis-tap from wiping the whole order: the first tap
  // arms the button ("Confirm?"), a second within 3s clears it.
  const clearCart = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (!clearArmed) {
      setClearArmed(true);
      clearTimer.current = setTimeout(() => setClearArmed(false), 3000);
      return;
    }
    setClearArmed(false);
    setLines([]);
    setCashReceived("");
  };

  const generate = async () => {
    if (!isOpen) {
      toast("Store is closed — new bills cannot be created", "error");
      return;
    }
    if (lines.length === 0) {
      toast("Add items to the order first", "error");
      return;
    }
    if (customer.name.trim() === "") {
      setNameErr("Customer name is required");
      return;
    }
    // Phone is optional, but a partial entry is a typo — block 1–9 digits.
    if (customer.phone.length > 0 && customer.phone.length !== 10) {
      setPhoneErr("Phone number must be exactly 10 digits");
      return;
    }
    setGenerating(true);
    try {
      const bill = await generateBill(customer, lines, payment, discountPct, currentUser?.name ?? "");
      setLines([]);
      setCustomer({ name: "", phone: "" });
      setPayment("Cash");
      setCashReceived("");
      setDiscount("");
      setPhoneErr("");
      setNameErr("");
      setClearArmed(false);
      setCartOpen(false);
      setReceipt(bill);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not generate bill", "error");
    } finally {
      setGenerating(false);
    }
  };

  const done = () => setReceipt(null);

  if (!isOpen) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-warm-white px-6 py-16 text-center shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger-bg text-3xl">
          🔒
        </div>
        <h2 className="text-lg font-extrabold text-ink">Store is closed</h2>
        <p className="mt-2 max-w-sm text-sm text-ink-muted">
          New bills can&apos;t be created while the store is closed. An admin can reopen the
          store from the status toggle to resume billing.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={`grid gap-4 lg:grid-cols-[1fr_372px] lg:pb-0 ${lines.length > 0 ? "pb-24" : ""}`}>
        {/* Products */}
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                placeholder="Search products to add…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-line bg-warm-white py-3 pl-3.5 pr-10 text-sm outline-none"
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
            <div className="flex shrink-0 gap-1.5 rounded-[10px] bg-cream-dark p-[3px]">
              <button
                type="button"
                onClick={() => setView("grid")}
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-[7px] border-none ${
                  view === "grid" ? "bg-brown text-warm-white" : "bg-transparent text-ink-muted"
                }`}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                aria-label="List view"
                aria-pressed={view === "list"}
                className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-[7px] border-none ${
                  view === "list" ? "bg-brown text-warm-white" : "bg-transparent text-ink-muted"
                }`}
              >
                <List size={16} />
              </button>
            </div>
          </div>
          <div className="mb-3.5 flex gap-2 overflow-x-auto pb-0.5">
            {["All", ...categories].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`shrink-0 whitespace-nowrap rounded-full px-[15px] py-[7px] text-[13px] font-bold cursor-pointer ${
                  category === c
                    ? "border border-brown bg-brown text-warm-white"
                    : "border border-line bg-warm-white text-ink-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {view === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
              {filteredItems.map(({ item, qty: freshQty, earliestExpiry: freshExpiry }) => {
                const inCart = cartQtyById.get(item.id) || 0;
                return (
                  <div key={item.id} className="relative">
                    <button
                      onClick={() => addToCart(item)}
                      className={`flex w-full flex-col overflow-hidden rounded-2xl border-[1.5px] text-left transition-all ${
                        inCart
                          ? "border-brown bg-warm-white shadow-[0_3px_12px_rgba(124,74,30,.14)]"
                          : "border-line bg-warm-white shadow-[0_1px_3px_rgba(100,60,20,.05)]"
                      }`}
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-cream">
                        <ItemThumb src={item.imageUrl} emoji={item.emoji} fill />
                      </div>
                      <div className="flex w-full flex-col gap-[6px] p-3">
                        <div className="line-clamp-2 min-h-[34px] text-[13.5px] font-bold leading-tight">
                          {item.name}
                        </div>
                        <div className="num text-[13px] font-extrabold text-brown">
                          {currency}
                          {item.price.toFixed(2)}
                        </div>
                        <div className="flex items-center gap-x-1.5 text-[11px] font-semibold text-ink-muted">
                          <span className="num min-w-0 truncate">
                            {freshQty} {item.unit}
                            {item.tracksExpiry && freshExpiry && ` · ${formatDate(freshExpiry)}`}
                          </span>
                          <ExpiryBadge
                            earliestExpiry={freshExpiry}
                            tracksExpiry={item.tracksExpiry}
                            windowDays={expiringSoonDays}
                            className="shrink-0"
                          />
                        </div>
                      </div>
                    </button>
                    {inCart > 0 && (
                      <span className="pointer-events-none absolute right-2 top-2 hidden h-[24px] min-w-[24px] items-center justify-center rounded-full bg-brown px-[6px] text-xs font-extrabold text-warm-white shadow-[0_2px_6px_rgba(100,60,20,0.25)] lg:flex">
                        {inCart}
                      </span>
                    )}
                    {inCart > 0 && (
                      <div className="absolute right-2 top-2 flex flex-col items-center gap-0.5 rounded-full bg-cream-dark p-1 shadow-[0_2px_8px_rgba(100,60,20,0.14)] lg:hidden">
                        <button
                          onClick={() => addToCart(item)}
                          disabled={inCart >= freshQty}
                          aria-label={`Add one ${item.name}`}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-none bg-warm-white text-lg font-extrabold leading-none text-brown transition-colors active:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          +
                        </button>
                        <span className="num min-w-[20px] py-0.5 text-center text-sm font-extrabold">
                          {inCart}
                        </span>
                        <button
                          onClick={() => removeFromCart(item)}
                          aria-label={`Remove one ${item.name}`}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-none bg-warm-white text-lg font-extrabold leading-none text-brown transition-colors active:bg-cream"
                        >
                          −
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)] lg:block">
                <div className="grid grid-cols-[2.5fr_1fr_auto] gap-3 bg-[#f8ecd8] px-5 py-[13px] text-[11.5px] font-bold uppercase tracking-[0.04em] text-[#8a6a3c]">
                  <div>Product</div>
                  <div className="text-right">Price</div>
                  <div className="min-w-[92px] text-right">In cart</div>
                </div>
                {filteredItems.map(({ item, qty: freshQty, earliestExpiry: freshExpiry }) => {
                  const inCart = cartQtyById.get(item.id) || 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() => addToCart(item)}
                      className="grid w-full grid-cols-[2.5fr_1fr_auto] items-center gap-3 border-t border-line-soft px-5 py-[13px] text-left transition-colors hover:bg-cream"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <ItemThumb src={item.imageUrl} emoji={item.emoji} size={46} />
                        <div className="min-w-0">
                          <div className="flex items-center">
                            <span className="truncate text-sm font-bold">{item.name}</span>
                            <ExpiryBadge
                              earliestExpiry={freshExpiry}
                              tracksExpiry={item.tracksExpiry}
                              windowDays={expiringSoonDays}
                            />
                          </div>
                          <div className="num text-[11.5px] font-semibold text-ink-muted">
                            {freshQty} {item.unit}
                            {item.tracksExpiry && freshExpiry &&
                              ` · Exp ${formatDate(freshExpiry)}`}
                          </div>
                        </div>
                      </div>
                      <div className="num text-right text-[13.5px] font-bold text-brown">
                        {currency}
                        {item.price.toFixed(2)}
                      </div>
                      <div className="flex min-w-[92px] justify-end">
                        {inCart > 0 ? (
                          <span className="num text-[13.5px] font-extrabold text-brown">{inCart}</span>
                        ) : (
                          <span className="text-ink-light">—</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Phone cards */}
              <div className="flex flex-col gap-2.5 lg:hidden">
                {filteredItems.map(({ item, qty: freshQty, earliestExpiry: freshExpiry }) => {
                  const inCart = cartQtyById.get(item.id) || 0;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 rounded-[15px] border bg-warm-white px-[15px] py-[13px] ${
                        inCart ? "border-[1.5px] border-brown" : "border-line"
                      }`}
                    >
                      <button
                        onClick={() => addToCart(item)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <ItemThumb src={item.imageUrl} emoji={item.emoji} size={54} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold">
                            {item.name}
                            <ExpiryBadge
                              earliestExpiry={freshExpiry}
                              tracksExpiry={item.tracksExpiry}
                              windowDays={expiringSoonDays}
                            />
                          </div>
                          <div className="num text-xs font-semibold text-ink-muted">
                            {currency}
                            {item.price.toFixed(2)} · {freshQty} {item.unit}
                            {item.tracksExpiry && freshExpiry &&
                              ` · ${formatDate(freshExpiry)}`}
                          </div>
                        </div>
                      </button>
                      {inCart > 0 && (
                        <div className="flex shrink-0 items-center gap-1.5 rounded-[9px] bg-cream-dark p-[3px]">
                          <button
                            onClick={() => removeFromCart(item)}
                            aria-label={`Remove one ${item.name}`}
                            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-lg font-extrabold text-brown"
                          >
                            −
                          </button>
                          <span className="num min-w-[20px] text-center text-sm font-extrabold">
                            {inCart}
                          </span>
                          <button
                            onClick={() => addToCart(item)}
                            disabled={inCart >= freshQty}
                            aria-label={`Add one ${item.name}`}
                            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-lg font-extrabold text-brown disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Mobile floating summary bar — tap to open the order sheet */}
        {lines.length > 0 && !cartOpen && (
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="fixed inset-x-4 bottom-[104px] z-[110] flex items-center justify-between gap-3 rounded-full bg-brown py-2.5 pl-3 pr-5 text-warm-white shadow-[0_10px_28px_rgba(124,74,30,0.45)] transition-transform active:scale-[0.98] lg:hidden"
          >
            <span className="flex items-center gap-3">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-warm-white/15">
                <ShoppingBasket size={18} />
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warm-white px-[4px] text-[11px] font-extrabold text-brown shadow-sm">
                  {cartCount}
                </span>
              </span>
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[13px] font-extrabold">View order</span>
                <span className="text-[11px] font-semibold text-warm-white/70">
                  {cartCount} item{cartCount === 1 ? "" : "s"}
                </span>
              </span>
            </span>
            <span className="num text-[15px] font-extrabold">
              {currency}
              {total.toFixed(2)}
            </span>
          </button>
        )}

        {/* Mobile backdrop when the sheet is open */}
        {cartOpen && (
          <div
            className="fixed inset-0 z-[200] bg-black/40 lg:hidden"
            onClick={() => setCartOpen(false)}
          />
        )}

        {/* Order panel — right sidebar on desktop, bottom sheet on mobile */}
        <div
          className={`fixed inset-x-0 bottom-0 z-[210] max-h-[85vh] overflow-y-auto rounded-t-[20px] border border-line bg-warm-white shadow-[0_-8px_30px_rgba(100,60,20,0.18)] transition-transform duration-300 lg:sticky lg:top-3.5 lg:z-auto lg:max-h-none lg:translate-y-0 lg:self-start lg:overflow-hidden lg:rounded-[18px] lg:shadow-[0_4px_18px_rgba(100,60,20,0.08)] ${
            cartOpen ? "translate-y-0" : "translate-y-full lg:translate-y-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line-soft px-[18px] py-4">
            <h3 className="text-base font-extrabold">Current order</h3>
            <div className="flex items-center gap-3">
              {lines.length > 0 && (
                <button
                  onClick={clearCart}
                  className={`flex cursor-pointer items-center rounded-lg border-none px-3 py-1.5 text-xs font-bold transition-transform active:scale-95 ${
                    clearArmed ? "bg-danger text-warm-white" : "bg-danger-bg text-danger"
                  }`}
                >
                  {clearArmed ? "Confirm clear?" : "Clear"}
                </button>
              )}
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Close order"
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-warm-white text-ink-muted lg:hidden"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-b border-line-soft px-[18px] py-3.5">
            <div className="relative">
              <Phone
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-light"
              />
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="Phone number (optional)"
                value={customer.phone}
                onChange={(e) => {
                  setCustomer((c) => ({ ...c, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }));
                  setPhoneErr("");
                }}
                onBlur={() =>
                  setPhoneErr(
                    customer.phone && customer.phone.length !== 10
                      ? "Phone number must be exactly 10 digits"
                      : "",
                  )
                }
                className="w-full rounded-[10px] border border-line bg-cream py-[9px] pl-9 pr-[11px] text-[13px] outline-none focus:border-brown"
              />
            </div>
            <div className="relative">
              <User
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-light"
              />
              <input
                type="text"
                placeholder="Customer name"
                value={customer.name}
                onChange={(e) => {
                  setCustomer((c) => ({ ...c, name: e.target.value }));
                  setNameErr("");
                }}
                onBlur={() =>
                  setNameErr(customer.name.trim() === "" ? "Customer name is required" : "")
                }
                className="w-full rounded-[10px] border border-line bg-cream py-[9px] pl-9 pr-[11px] text-[13px] outline-none focus:border-brown"
              />
            </div>
          </div>
          {nameErr && (
            <div className="border-b border-line-soft px-[18px] py-2 text-[11px] font-semibold text-danger">
              {nameErr}
            </div>
          )}
          {phoneErr && (
            <div className="border-b border-line-soft px-[18px] py-2 text-[11px] font-semibold text-danger">
              {phoneErr}
            </div>
          )}
          {returning && (
            <div className="flex items-center gap-1.5 border-b border-line-soft bg-success-bg px-[18px] py-2 text-[11px] font-bold text-success">
              <UserCheck size={13} />
              Returning customer · {returning.visitCount} visit{returning.visitCount === 1 ? "" : "s"}
            </div>
          )}

          {lines.length === 0 ? (
            <div className="p-11 text-center text-ink-light">
              <div className="mb-2 flex justify-center">
                <ShoppingBasket size={34} />
              </div>
              <div className="text-[13.5px] font-semibold">Tap products to add them here</div>
            </div>
          ) : (
            <>
              <div className="max-h-[300px] overflow-y-auto px-2 py-1.5">
                {lines.map((bi, idx) => (
                  <div key={bi.itemId} className="flex items-center gap-2.5 rounded-xl px-2.5 py-[9px]">
                    <ItemThumb src={bi.imageUrl} emoji={bi.emoji} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold">{bi.name}</div>
                      <div className="num text-[11.5px] text-ink-light">
                        {currency}
                        {bi.price.toFixed(2)} each
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-[9px] bg-cream-dark p-[3px]">
                      <button
                        onClick={() => dec(idx)}
                        aria-label={`Remove one ${bi.name}`}
                        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-base font-extrabold text-brown"
                      >
                        −
                      </button>
                      <span className="num min-w-[20px] text-center text-[13.5px] font-extrabold">
                        {bi.qty}
                      </span>
                      <button
                        onClick={() => inc(idx)}
                        disabled={bi.qty >= (freshQtyById.get(bi.itemId) ?? 0)}
                        aria-label={`Add one ${bi.name}`}
                        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-base font-extrabold text-brown disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    <div className="num w-[62px] text-right text-[13.5px] font-extrabold">
                      {currency}
                      {(bi.qty * bi.price).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-line-soft bg-cream px-[18px] py-3.5">
                <div className="flex justify-between py-0.5 text-[13px] font-semibold text-ink-muted">
                  <span>Subtotal</span>
                  <span className="num">
                    {currency}
                    {subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-0.5 text-[13px] font-semibold text-ink-muted">
                  <span className="flex items-center gap-1.5">
                    Discount
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      placeholder="0"
                      value={discount}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (e.target.value !== "" && !isNaN(n) && (n < 0 || n > 100)) {
                          setDiscount(String(Math.min(100, Math.max(0, n))));
                        } else {
                          setDiscount(e.target.value);
                        }
                      }}
                      className="w-14 rounded-[8px] border border-line bg-warm-white px-2 py-1 text-right text-[13px] outline-none focus:border-brown"
                    />
                    %
                  </span>
                  <span className="num text-danger">
                    {discountAmt > 0 ? `−${currency}${discountAmt.toFixed(2)}` : `${currency}0.00`}
                  </span>
                </div>
                {tax > 0 && (
                  <div className="flex justify-between py-0.5 text-[13px] font-semibold text-ink-muted">
                    <span>Tax ({taxRate}%)</span>
                    <span className="num">
                      {currency}
                      {tax.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="mt-[7px] flex justify-between border-t-[1.5px] border-line pt-[9px] text-lg font-extrabold">
                  <span>Total</span>
                  <span className="num">
                    {currency}
                    {total.toFixed(2)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink-muted">Paid via</span>
                  <div className="flex gap-1.5 rounded-[10px] bg-cream-dark p-[3px]">
                    {(["Cash", "UPI"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setPayment(m);
                          if (m !== "Cash") setCashReceived("");
                        }}
                        className={`cursor-pointer rounded-[7px] border-none px-3.5 py-1 text-[12.5px] font-bold ${
                          payment === m
                            ? "bg-brown text-warm-white"
                            : "bg-transparent text-ink-muted"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                {payment === "Cash" && (
                  <>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-ink-muted">Cash received</span>
                      <div className="relative w-[110px]">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ink-light">
                          {currency}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={cashReceived}
                          onChange={(e) => setCashReceived(e.target.value)}
                          className="num w-full rounded-[8px] border border-line bg-warm-white py-1 pl-6 pr-2 text-right text-[13px] outline-none focus:border-brown"
                        />
                      </div>
                    </div>
                    {cashReceived !== "" && (
                      <div className="mt-1.5 flex justify-between text-[13px] font-bold">
                        <span className={changeDue < 0 ? "text-danger" : "text-ink"}>
                          {changeDue < 0 ? "Short by" : "Change due"}
                        </span>
                        <span className={`num ${changeDue < 0 ? "text-danger" : "text-success"}`}>
                          {currency}
                          {Math.abs(changeDue).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                <button
                  onClick={generate}
                  disabled={
                    generating ||
                    !isOpen ||
                    customer.name.trim() === "" ||
                    (customer.phone.length > 0 && customer.phone.length !== 10)
                  }
                  className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-[13px] border-none bg-brown p-3.5 text-[15px] font-extrabold text-warm-white shadow-[0_4px_14px_rgba(124,74,30,.3)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ReceiptIcon size={16} />
                  )}
                  {generating ? "Generating…" : `Generate bill · ${currency}${total.toFixed(2)}`}
                </button>
                {!generating && disabledReason && (
                  <p className="mt-2 text-center text-[11.5px] font-semibold text-ink-muted">
                    {disabledReason}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {receipt && (
        <Modal title={`Bill #${receipt.billNo}`} onClose={done}>
          <Receipt bill={receipt} />
          <div className="mt-4 flex gap-2.5">
            <button
              className="btn-primary flex flex-1 items-center justify-center gap-2"
              onClick={() => requestPrint(receipt)}
            >
              <Printer size={16} /> Print
            </button>
            <button className="btn-secondary flex flex-1 items-center justify-center gap-2" onClick={done}>
              <Check size={16} /> Done
            </button>
          </div>
          <div className="mt-2.5 text-center text-xs text-ink-muted">
            Print to a 3&quot; (80mm) thermal printer
          </div>
        </Modal>
      )}
    </>
  );
}
