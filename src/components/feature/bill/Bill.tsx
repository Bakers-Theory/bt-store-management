"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Printer, Receipt as ReceiptIcon, ShoppingBasket } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { computeTotals } from "@/lib/bill";
import { Modal } from "@/components/ui/Modal";
import { Receipt } from "./Receipt";
import type { Bill as BillType, BillLine, Item, PaymentMethod } from "@/lib/types";

export function Bill() {
  const items = useBakeryStore((s) => s.items);
  const currency = useBakeryStore((s) => s.bakery.currency);
  const taxRate = useBakeryStore((s) => s.bakery.taxRate);
  const generateBill = useBakeryStore((s) => s.generateBill);
  const categories = useBakeryStore((s) => s.lists.categories);
  const toast = useUIStore((s) => s.toast);
  const requestPrint = useUIStore((s) => s.requestPrint);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [payment, setPayment] = useState<PaymentMethod>("Cash");
  const [discount, setDiscount] = useState("");
  const [phoneErr, setPhoneErr] = useState("");
  const [generating, setGenerating] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [receipt, setReceipt] = useState<BillType | null>(null);

  const discountPct = Math.min(100, Math.max(0, parseFloat(discount) || 0));
  const { subtotal, discount: discountAmt, tax, total } = computeTotals(lines, taxRate, discountPct);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        (category === "All" || i.category === category) &&
        i.name.toLowerCase().includes(q),
    );
  }, [items, search, category]);

  const cartQtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) map.set(l.itemId, l.qty);
    return map;
  }, [lines]);

  const addToCart = (item: Item) => {
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
          unit: item.unit,
          qty: 1,
          price: item.price,
          costPrice: item.costPrice || 0,
        },
      ];
    });
  };

  const inc = (idx: number) =>
    setLines((prev) => prev.map((bi, i) => (i === idx ? { ...bi, qty: bi.qty + 1 } : bi)));

  const dec = (idx: number) =>
    setLines((prev) => {
      const line = prev[idx];
      if (line.qty <= 1) return prev.filter((_, i) => i !== idx);
      return prev.map((bi, i) => (i === idx ? { ...bi, qty: bi.qty - 1 } : bi));
    });

  const clearCart = () => setLines([]);

  const generate = async () => {
    if (lines.length === 0) {
      toast("Add items to the order first");
      return;
    }
    if (customer.phone && customer.phone.length !== 10) {
      setPhoneErr("Phone number must be exactly 10 digits");
      return;
    }
    setGenerating(true);
    try {
      const bill = await generateBill(customer, lines, payment, discountPct);
      setLines([]);
      setCustomer({ name: "", phone: "" });
      setPayment("Cash");
      setDiscount("");
      setPhoneErr("");
      setReceipt(bill);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not generate bill");
    } finally {
      setGenerating(false);
    }
  };

  const done = () => setReceipt(null);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1fr_372px]">
        {/* Products */}
        <div className="min-w-0">
          <input
            type="text"
            placeholder="Search products to add…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-3 w-full rounded-xl border border-line bg-warm-white px-3.5 py-3 text-sm outline-none"
          />
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
            {filteredItems.map((item) => {
              const inCart = cartQtyById.get(item.id) || 0;
              return (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className={`relative flex flex-col gap-[7px] rounded-2xl p-3.5 text-left transition-all ${
                    inCart
                      ? "border-[1.5px] border-brown bg-warm-white shadow-[0_3px_12px_rgba(124,74,30,.14)]"
                      : "border border-line bg-warm-white shadow-[0_1px_3px_rgba(100,60,20,.05)]"
                  }`}
                >
                  {inCart > 0 && (
                    <span className="absolute right-[9px] top-[9px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-brown px-[5px] text-xs font-extrabold text-warm-white">
                      {inCart}
                    </span>
                  )}
                  <div className="text-[34px] leading-none">{item.emoji || "📦"}</div>
                  <div className="text-[13.5px] font-bold leading-tight">{item.name}</div>
                  <div className="num text-[13px] font-extrabold text-brown">
                    {currency}
                    {item.price.toFixed(2)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Order panel */}
        <div className="sticky top-3.5 overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_4px_18px_rgba(100,60,20,0.08)]">
          <div className="flex items-center justify-between border-b border-line-soft px-[18px] py-4">
            <h3 className="text-base font-extrabold">Current order</h3>
            {lines.length > 0 && (
              <button
                onClick={clearCart}
                className="cursor-pointer border-none bg-transparent text-xs font-bold text-danger"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex gap-2.5 border-b border-line-soft px-[18px] py-3.5">
            <input
              type="text"
              placeholder="Customer name"
              value={customer.name}
              onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
              className="min-w-0 flex-1 rounded-[10px] border border-line bg-cream px-[11px] py-[9px] text-[13px] outline-none"
            />
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="Phone"
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
              className="w-[110px] rounded-[10px] border border-line bg-cream px-[11px] py-[9px] text-[13px] outline-none"
            />
          </div>
          {phoneErr && (
            <div className="border-b border-line-soft px-[18px] py-2 text-[11px] font-semibold text-danger">
              {phoneErr}
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
                    <span className="text-2xl">{bi.emoji || "📦"}</span>
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
                        className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-base font-extrabold text-brown"
                      >
                        −
                      </button>
                      <span className="num min-w-[20px] text-center text-[13.5px] font-extrabold">
                        {bi.qty}
                      </span>
                      <button
                        onClick={() => inc(idx)}
                        className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] border-none bg-warm-white text-base font-extrabold text-brown"
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
                <div className="flex justify-between py-0.5 text-[13px] font-semibold text-ink-muted">
                  <span>Tax ({taxRate}%)</span>
                  <span className="num">
                    {currency}
                    {tax.toFixed(2)}
                  </span>
                </div>
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
                        onClick={() => setPayment(m)}
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
                <button
                  onClick={generate}
                  disabled={generating}
                  className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-[13px] border-none bg-brown p-3.5 text-[15px] font-extrabold text-warm-white shadow-[0_4px_14px_rgba(124,74,30,.3)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ReceiptIcon size={16} />
                  )}
                  {generating ? "Generating…" : `Generate bill · ${currency}${total.toFixed(2)}`}
                </button>
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
            Print to a 3&quot; (76mm) thermal printer
          </div>
        </Modal>
      )}
    </>
  );
}
