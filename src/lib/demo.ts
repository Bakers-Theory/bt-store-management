import type { Bakery, Bill, BillLine, Item, Log, User } from "./types";
import { computeTotals } from "./bill";

/**
 * Demo dataset, loaded on hydration when `NEXT_PUBLIC_APP_ENV === "test"` and
 * the store is empty (see `seedDemo` in store.ts). Everything is deterministic
 * given `now`, so ids/values are stable across reloads. Dates are computed as
 * offsets from `now` so charts (last-7-days) and the month-over-month growth
 * report always have fresh, meaningful data.
 */

const TAX_RATE = 5;

/** Bakery identity applied only when the current bakery is still the default. */
export const DEMO_BAKERY: Partial<Bakery> = {
  name: "Bakers Theory",
  tagline: "Baked fresh, every day",
  address: "42 MG Road, Bengaluru 560001",
  phone: "9876500000",
  gst: "29ABCDE1234F1Z5",
  currency: "₹",
  taxRate: TAX_RATE,
  lowStockAlert: 5,
};

/** A demo staff account (no analytics) to showcase role-based access. */
export const DEMO_STAFF: User = {
  id: "demo-staff",
  name: "Aarav (Counter)",
  userId: "staff01",
  password: "staff123",
  role: "Staff",
  permissions: { sales: true, inventory: true, analytics: false },
};

interface DemoItemSpec {
  key: string;
  name: string;
  emoji: string;
  category: string;
  unit: string;
  price: number;
  costPrice: number;
  qty: number; // current on-hand stock
}

// Stock levels chosen to exercise the analytics verdicts:
//  - baguette: low stock + still selling  → "Reorder now"
//  - cookie:   plenty of stock, tiny sales → "Slow-moving"
//  - cheesecake: never sold, still in stock → "Dead stock"
const ITEMS: DemoItemSpec[] = [
  { key: "sourdough", name: "Sourdough Loaf", emoji: "🍞", category: "Breads", unit: "pcs", price: 120, costPrice: 55, qty: 24 },
  { key: "baguette", name: "Baguette", emoji: "🥖", category: "Breads", unit: "pcs", price: 80, costPrice: 35, qty: 4 },
  { key: "croissant", name: "Butter Croissant", emoji: "🥐", category: "Pastries", unit: "pcs", price: 60, costPrice: 22, qty: 46 },
  { key: "redvelvet", name: "Red Velvet Pastry", emoji: "🍰", category: "Pastries", unit: "pcs", price: 90, costPrice: 40, qty: 20 },
  { key: "choccake", name: "Chocolate Truffle Cake", emoji: "🎂", category: "Cakes", unit: "pcs", price: 650, costPrice: 300, qty: 6 },
  { key: "muffin", name: "Blueberry Muffin", emoji: "🧁", category: "Cakes", unit: "pcs", price: 70, costPrice: 28, qty: 32 },
  { key: "cheesecake", name: "New York Cheesecake", emoji: "🍰", category: "Cakes", unit: "pcs", price: 720, costPrice: 340, qty: 5 },
  { key: "cappuccino", name: "Cappuccino", emoji: "☕", category: "Beverages", unit: "pcs", price: 110, costPrice: 35, qty: 100 },
  { key: "coldcoffee", name: "Cold Coffee", emoji: "🥤", category: "Beverages", unit: "pcs", price: 130, costPrice: 45, qty: 80 },
  { key: "cookie", name: "Choco Chip Cookie", emoji: "🍪", category: "Cookies", unit: "pcs", price: 40, costPrice: 15, qty: 60 },
];

interface DemoOrder {
  day: number; // days before `now`
  hour: number;
  customer: string;
  phone: string;
  cancelled?: boolean;
  lines: { key: string; qty: number }[];
}

// Spread across ~2.5 months so growth analysis has multiple months, with a
// cluster in the last week and two orders today for the dashboard stat cards.
const ORDERS: DemoOrder[] = [
  { day: 74, hour: 9, customer: "Riya Sharma", phone: "9810011111", lines: [{ key: "sourdough", qty: 2 }, { key: "croissant", qty: 3 }] },
  { day: 71, hour: 18, customer: "Walk-in", phone: "", lines: [{ key: "cappuccino", qty: 2 }, { key: "muffin", qty: 2 }] },
  { day: 66, hour: 11, customer: "Kabir Mehta", phone: "9810022222", lines: [{ key: "choccake", qty: 1 }, { key: "coldcoffee", qty: 2 }] },
  { day: 60, hour: 13, customer: "Walk-in", phone: "", lines: [{ key: "baguette", qty: 2 }, { key: "redvelvet", qty: 2 }] },
  { day: 54, hour: 10, customer: "Neha Gupta", phone: "9810033333", lines: [{ key: "sourdough", qty: 3 }, { key: "cappuccino", qty: 1 }, { key: "cookie", qty: 1 }] },
  { day: 48, hour: 16, customer: "Walk-in", phone: "", lines: [{ key: "croissant", qty: 4 }, { key: "coldcoffee", qty: 2 }] },
  { day: 41, hour: 12, customer: "Arjun Rao", phone: "9810044444", lines: [{ key: "choccake", qty: 1 }, { key: "muffin", qty: 3 }] },
  { day: 35, hour: 9, customer: "Walk-in", phone: "", lines: [{ key: "baguette", qty: 3 }, { key: "cappuccino", qty: 2 }] },
  { day: 30, hour: 17, customer: "Sara Khan", phone: "9810055555", lines: [{ key: "redvelvet", qty: 4 }, { key: "coldcoffee", qty: 1 }] },
  { day: 24, hour: 11, customer: "Walk-in", phone: "", lines: [{ key: "sourdough", qty: 2 }, { key: "croissant", qty: 2 }] },
  { day: 20, hour: 14, customer: "Vikram Singh", phone: "9810066666", cancelled: true, lines: [{ key: "choccake", qty: 1 }] },
  { day: 15, hour: 10, customer: "Walk-in", phone: "", lines: [{ key: "muffin", qty: 4 }, { key: "cappuccino", qty: 3 }] },
  { day: 10, hour: 18, customer: "Priya Nair", phone: "9810077777", lines: [{ key: "sourdough", qty: 4 }, { key: "redvelvet", qty: 2 }, { key: "coldcoffee", qty: 2 }] },
  { day: 6, hour: 9, customer: "Walk-in", phone: "", lines: [{ key: "croissant", qty: 5 }, { key: "cappuccino", qty: 2 }] },
  { day: 5, hour: 13, customer: "Rohit Verma", phone: "9810088888", lines: [{ key: "baguette", qty: 2 }, { key: "muffin", qty: 2 }] },
  { day: 3, hour: 11, customer: "Walk-in", phone: "", lines: [{ key: "choccake", qty: 1 }, { key: "coldcoffee", qty: 3 }] },
  { day: 2, hour: 16, customer: "Ananya Das", phone: "9810099999", lines: [{ key: "sourdough", qty: 2 }, { key: "croissant", qty: 3 }, { key: "cappuccino", qty: 1 }] },
  { day: 1, hour: 18, customer: "Walk-in", phone: "", lines: [{ key: "redvelvet", qty: 3 }, { key: "muffin", qty: 2 }] },
  { day: 0, hour: 9, customer: "Walk-in", phone: "", lines: [{ key: "croissant", qty: 4 }, { key: "coldcoffee", qty: 2 }] },
  { day: 0, hour: 12, customer: "Meera Iyer", phone: "9810010101", lines: [{ key: "sourdough", qty: 3 }, { key: "cappuccino", qty: 2 }, { key: "muffin", qty: 1 }] },
];

export interface DemoData {
  items: Item[];
  bills: Bill[];
  logs: Log[];
  nextBillNo: number;
}

/** Build the demo items/bills/logs, deterministic for a given `now`. */
export function buildDemoData(now: Date): DemoData {
  const itemByKey = new Map<string, Item>();
  const items: Item[] = ITEMS.map((spec) => {
    const item: Item = {
      id: `demo-${spec.key}`,
      name: spec.name,
      emoji: spec.emoji,
      category: spec.category,
      unit: spec.unit,
      price: spec.price,
      costPrice: spec.costPrice,
      qty: spec.qty,
    };
    itemByKey.set(spec.key, item);
    return item;
  });

  const logs: Log[] = [];

  // Opening-stock log for each item, dated before the first order.
  const openDate = new Date(now);
  openDate.setDate(openDate.getDate() - 80);
  items.forEach((it, idx) => {
    logs.push({
      id: `demo-log-open-${idx}`,
      type: "in",
      itemId: it.id,
      itemName: it.name,
      qty: it.qty,
      supplier: "Opening stock",
      date: new Date(openDate.getTime() + idx * 60000).toISOString(),
    });
  });

  const bills: Bill[] = ORDERS.map((o, idx) => {
    const lines: BillLine[] = o.lines.map((l) => {
      const it = itemByKey.get(l.key)!;
      return { itemId: it.id, name: it.name, emoji: it.emoji, unit: it.unit, qty: l.qty, price: it.price, costPrice: it.costPrice };
    });
    const { subtotal, tax, total } = computeTotals(lines, TAX_RATE);
    const d = new Date(now);
    d.setDate(d.getDate() - o.day);
    d.setHours(o.hour, (idx * 7) % 60, 0, 0);
    const iso = d.toISOString();
    const billNo = 1001 + idx;

    logs.push({ id: `demo-log-bill-${idx}`, type: "bill", billNo, items: lines.map((l) => l.name).join(", "), total, date: iso });
    if (o.cancelled)
      logs.push({ id: `demo-log-cancel-${idx}`, type: "cancel", billNo, items: lines.map((l) => l.name).join(", "), total, notes: "Cancelled by Owner", date: iso });

    return {
      id: `demo-b${idx}`,
      billNo,
      customerName: o.customer,
      customerPhone: o.phone,
      items: lines,
      subtotal,
      tax,
      total,
      taxRate: TAX_RATE,
      date: iso,
      status: o.cancelled ? "cancelled" : "active",
      ...(o.cancelled ? { cancelledAt: iso, cancelledBy: "Owner" } : {}),
    } satisfies Bill;
  });

  bills.sort((a, b) => +new Date(a.date) - +new Date(b.date));

  return { items, bills, logs, nextBillNo: 1001 + ORDERS.length };
}
