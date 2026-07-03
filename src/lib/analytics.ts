import type { Bill, BillLine, Item } from "./types";
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

/** Cost price for a bill line — prefer the price recorded at sale time. */
function lineCost(line: BillLine, items: Item[]): number {
  return line.costPrice != null
    ? line.costPrice
    : items.find((i) => i.id === line.itemId)?.costPrice || 0;
}

export interface CategoryPL {
  category: string;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number | null; // null when revenue is 0
  sharePct: number | null;
}

/** Per-category profit & loss from active bills, sorted by profit descending. */
export function categoryPL(bills: Bill[], items: Item[]): CategoryPL[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const agg = new Map<string, { revenue: number; cogs: number }>();

  for (const b of bills) {
    if (!isActiveBill(b)) continue;
    for (const line of b.items) {
      const cat = byId.get(line.itemId)?.category || "General";
      const cur = agg.get(cat) ?? { revenue: 0, cogs: 0 };
      cur.revenue += line.qty * line.price;
      cur.cogs += line.qty * lineCost(line, items);
      agg.set(cat, cur);
    }
  }

  const total = Array.from(agg.values()).reduce((s, c) => s + c.revenue, 0);
  return Array.from(agg.entries())
    .map(([category, c]) => {
      const profit = c.revenue - c.cogs;
      return {
        category,
        revenue: c.revenue,
        cogs: c.cogs,
        profit,
        marginPct: c.revenue ? (profit / c.revenue) * 100 : null,
        sharePct: total ? (c.revenue / total) * 100 : null,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

export type StockVerdict =
  | "Reorder now"
  | "Reorder soon"
  | "Slow-moving"
  | "Dead stock"
  | "Healthy";

export interface StockHealthRow {
  item: Item;
  sold: number;
  perDay: number;
  daysCover: number | null; // null => nothing selling (infinite cover)
  verdict: StockVerdict;
}

/** Days-of-cover and reorder verdict per item, based on active-bill sales rate. */
export function stockHealth(
  bills: Bill[],
  items: Item[],
  lowStockAlert: number
): StockHealthRow[] {
  const active = bills.filter(isActiveBill);
  const dates = active.map((b) => +new Date(b.date));
  const daySpan =
    dates.length > 0
      ? Math.max(1, Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000) + 1)
      : 1;

  const soldById = new Map<string, number>();
  for (const b of active)
    for (const line of b.items)
      soldById.set(line.itemId, (soldById.get(line.itemId) ?? 0) + line.qty);

  return items.map((item) => {
    const sold = soldById.get(item.id) ?? 0;
    const perDay = sold / daySpan;
    const daysCover = perDay > 0 ? item.qty / perDay : null;
    let verdict: StockVerdict;
    if (sold === 0) verdict = "Dead stock";
    else if (item.qty <= lowStockAlert) verdict = "Reorder now";
    else if (daysCover !== null && daysCover <= 7) verdict = "Reorder soon";
    else if (daysCover !== null && daysCover > 90) verdict = "Slow-moving";
    else verdict = "Healthy";
    return { item, sold, perDay, daysCover, verdict };
  });
}

export interface Recommendation {
  priority: "High" | "Medium" | "Low" | "Info";
  insight: string;
  detail: string;
}

const fmtHour = (h: number): string => {
  const period = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${period}`;
};

/** Plain-language business-boosting recommendations derived from sales + stock. */
export function recommendations(
  bills: Bill[],
  items: Item[],
  lowStockAlert: number,
  currency: string
): Recommendation[] {
  const active = bills.filter(isActiveBill);
  const health = stockHealth(bills, items, lowStockAlert);
  const recs: Recommendation[] = [];
  const names = (arr: StockHealthRow[]) =>
    arr.map((s) => s.item.name).slice(0, 8).join(", ");

  const reorderNow = health.filter((s) => s.verdict === "Reorder now");
  if (reorderNow.length)
    recs.push({ priority: "High", insight: `Reorder ${reorderNow.length} item${reorderNow.length > 1 ? "s" : ""} now`, detail: names(reorderNow) });

  const reorderSoon = health.filter((s) => s.verdict === "Reorder soon");
  if (reorderSoon.length)
    recs.push({
      priority: "Medium",
      insight: `${reorderSoon.length} item${reorderSoon.length > 1 ? "s" : ""} running low (≤7 days cover)`,
      detail: reorderSoon.map((s) => `${s.item.name} (${s.daysCover!.toFixed(0)}d)`).slice(0, 8).join(", "),
    });

  const dead = health.filter((s) => s.verdict === "Dead stock" && s.item.qty > 0);
  if (dead.length)
    recs.push({ priority: "Medium", insight: `${dead.length} item${dead.length > 1 ? "s" : ""} not selling — discount or bundle`, detail: names(dead) });

  const slow = health.filter((s) => s.verdict === "Slow-moving");
  if (slow.length)
    recs.push({ priority: "Low", insight: `${slow.length} slow-moving item${slow.length > 1 ? "s" : ""} (>90 days cover)`, detail: names(slow) });

  const withMargin = health
    .filter((s) => s.item.price > 0 && s.item.costPrice > 0 && s.sold > 0)
    .map((s) => ({ name: s.item.name, marginPct: ((s.item.price - s.item.costPrice) / s.item.price) * 100 }));
  if (withMargin.length) {
    const lowest = withMargin.reduce((a, b) => (a.marginPct < b.marginPct ? a : b));
    if (lowest.marginPct < 30)
      recs.push({ priority: "Medium", insight: `Raise price on ${lowest.name}`, detail: `Margin is only ${lowest.marginPct.toFixed(1)}% — a small price bump adds direct profit.` });
    const highest = withMargin.reduce((a, b) => (a.marginPct > b.marginPct ? a : b));
    recs.push({ priority: "Low", insight: `Promote ${highest.name}`, detail: `Best margin at ${highest.marginPct.toFixed(1)}% — pushing sales here boosts profit fastest.` });
  }

  const dowRevenue = new Map<string, number>();
  for (const b of active) {
    const day = new Date(b.date).toLocaleDateString("en-US", { weekday: "long" });
    dowRevenue.set(day, (dowRevenue.get(day) ?? 0) + b.total);
  }
  const bestDay = Array.from(dowRevenue.entries()).sort((a, b) => b[1] - a[1])[0];
  if (bestDay)
    recs.push({ priority: "Info", insight: `${bestDay[0]} is your best sales day`, detail: `${currency} ${bestDay[1].toFixed(2)} in total revenue — plan extra stock and staff.` });

  const hourCount = new Map<number, number>();
  for (const b of active) {
    const h = new Date(b.date).getHours();
    hourCount.set(h, (hourCount.get(h) ?? 0) + 1);
  }
  const bestHour = Array.from(hourCount.entries()).sort((a, b) => b[1] - a[1])[0];
  if (bestHour)
    recs.push({ priority: "Info", insight: `Busiest around ${fmtHour(bestHour[0])}`, detail: `${bestHour[1]} bills in that hour — prep ahead of the rush.` });

  const revenueByName = new Map<string, number>();
  for (const b of active)
    for (const line of b.items)
      revenueByName.set(line.name, (revenueByName.get(line.name) ?? 0) + line.qty * line.price);
  const topEarner = Array.from(revenueByName.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topEarner)
    recs.push({ priority: "Info", insight: `Top earner: ${topEarner[0]}`, detail: `${currency} ${topEarner[1].toFixed(2)} in revenue — your signature product.` });

  if (recs.length === 0)
    recs.push({ priority: "Info", insight: "Not enough data yet", detail: "Generate a few bills to unlock recommendations." });

  return recs;
}
