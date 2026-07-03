import type { Bill, Item } from "./types";
import { isActiveBill } from "./format";

export function weeklySales(
  bills: Bill[],
  now: Date
): { label: string; total: number }[] {
  const buckets: { key: string; label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.push({
      key: d.toDateString(),
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      total: 0,
    });
  }

  for (const b of bills) {
    if (!isActiveBill(b)) continue;
    const key = new Date(b.date).toDateString();
    const bucket = buckets.find((x) => x.key === key);
    if (bucket) bucket.total += b.total;
  }

  return buckets.map(({ label, total }) => ({ label, total }));
}

export function topItems(
  bills: Bill[],
  limit = 5
): { name: string; qty: number }[] {
  const qtyByItem = new Map<string, { name: string; qty: number }>();

  for (const b of bills) {
    if (!isActiveBill(b)) continue;
    for (const line of b.items) {
      const existing = qtyByItem.get(line.itemId);
      if (existing) {
        existing.qty += line.qty;
      } else {
        qtyByItem.set(line.itemId, { name: line.name, qty: line.qty });
      }
    }
  }

  return Array.from(qtyByItem.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);
}

export function categoryRevenue(
  bills: Bill[],
  items: Item[]
): { category: string; revenue: number }[] {
  const categoryByItemId = new Map(items.map((i) => [i.id, i.category]));
  const revenueByCategory = new Map<string, number>();

  for (const b of bills) {
    if (!isActiveBill(b)) continue;
    for (const line of b.items) {
      const category = categoryByItemId.get(line.itemId);
      if (!category) continue;
      const revenue = line.qty * line.price;
      revenueByCategory.set(
        category,
        (revenueByCategory.get(category) ?? 0) + revenue
      );
    }
  }

  return Array.from(revenueByCategory.entries())
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}
