import type { Bill, BillLine, Item } from "./types";
import { isActiveBill } from "./format";

// ─── Weekly sales buckets ─────────────────────────────────────────────────────
// The dashboard receives per-day active-sales totals from the server; this fills
// the 7 fixed day buckets (oldest→newest, ending today) and labels them. Kept
// client-side so the labels use the viewer's locale.
export function weeklyBuckets(
  daily: { date: string; total: number }[],
  now: Date
): { label: string; total: number }[] {
  const totalByKey = new Map<string, number>();
  for (const d of daily) {
    // `date` is a local calendar date (YYYY-MM-DD) from the server; parse it as
    // local midnight so it lines up with the buckets below.
    const key = new Date(`${d.date}T00:00:00`).toDateString();
    totalByKey.set(key, (totalByKey.get(key) ?? 0) + d.total);
  }

  const buckets: { label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      total: totalByKey.get(d.toDateString()) ?? 0,
    });
  }
  return buckets;
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

/** Per-category P&L from pre-aggregated revenue/cogs, sorted by profit descending. */
export function categoryPLFrom(
  cats: { category: string; revenue: number; cogs: number }[]
): CategoryPL[] {
  const total = cats.reduce((s, c) => s + c.revenue, 0);
  return cats
    .map(({ category, revenue, cogs }) => {
      const profit = revenue - cogs;
      return {
        category,
        revenue,
        cogs,
        profit,
        marginPct: revenue ? (profit / revenue) * 100 : null,
        sharePct: total ? (revenue / total) * 100 : null,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

/** Per-category profit & loss from active bills, sorted by profit descending. */
export function categoryPL(bills: Bill[], items: Item[]): CategoryPL[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const agg = new Map<string, { category: string; revenue: number; cogs: number }>();

  for (const b of bills) {
    if (!isActiveBill(b)) continue;
    for (const line of b.items) {
      const cat = byId.get(line.itemId)?.category || "General";
      const cur = agg.get(cat) ?? { category: cat, revenue: 0, cogs: 0 };
      cur.revenue += line.qty * line.price;
      cur.cogs += line.qty * lineCost(line, items);
      agg.set(cat, cur);
    }
  }

  return categoryPLFrom(Array.from(agg.values()));
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

/** Days-of-cover and reorder verdict per item, from pre-aggregated sales. */
export function stockHealthFrom(
  soldById: Map<string, number>,
  daySpan: number,
  items: Item[],
  lowStockAlert: number
): StockHealthRow[] {
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

  return stockHealthFrom(soldById, daySpan, items, lowStockAlert);
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

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** Pre-aggregated inputs for {@link recommendationsFrom}. */
export interface RecommendationInputs {
  health: StockHealthRow[];
  dowRevenue: { dow: number; total: number }[]; // dow 0=Sun..6=Sat
  hourCounts: { hour: number; count: number }[];
  topEarner: { name: string; revenue: number } | null;
}

/** Plain-language business-boosting recommendations from pre-aggregated inputs. */
export function recommendationsFrom(
  { health, dowRevenue, hourCounts, topEarner }: RecommendationInputs,
  currency: string
): Recommendation[] {
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

  const bestDay = [...dowRevenue].sort((a, b) => b.total - a.total)[0];
  if (bestDay)
    recs.push({ priority: "Info", insight: `${WEEKDAYS[bestDay.dow]} is your best sales day`, detail: `${currency} ${bestDay.total.toFixed(2)} in total revenue — plan extra stock and staff.` });

  const bestHour = [...hourCounts].sort((a, b) => b.count - a.count)[0];
  if (bestHour)
    recs.push({ priority: "Info", insight: `Busiest around ${fmtHour(bestHour.hour)}`, detail: `${bestHour.count} bills in that hour — prep ahead of the rush.` });

  if (topEarner)
    recs.push({ priority: "Info", insight: `Top earner: ${topEarner.name}`, detail: `${currency} ${topEarner.revenue.toFixed(2)} in revenue — your signature product.` });

  if (recs.length === 0)
    recs.push({ priority: "Info", insight: "Not enough data yet", detail: "Generate a few bills to unlock recommendations." });

  return recs;
}

/** Plain-language business-boosting recommendations derived from sales + stock. */
export function recommendations(
  bills: Bill[],
  items: Item[],
  lowStockAlert: number,
  currency: string
): Recommendation[] {
  const active = bills.filter(isActiveBill);
  const health = stockHealth(bills, items, lowStockAlert);

  const dowMap = new Map<number, number>();
  const hourMap = new Map<number, number>();
  const revenueByName = new Map<string, number>();
  for (const b of active) {
    const d = new Date(b.date);
    dowMap.set(d.getDay(), (dowMap.get(d.getDay()) ?? 0) + b.total);
    hourMap.set(d.getHours(), (hourMap.get(d.getHours()) ?? 0) + 1);
    for (const line of b.items)
      revenueByName.set(line.name, (revenueByName.get(line.name) ?? 0) + line.qty * line.price);
  }

  const topEarnerEntry = Array.from(revenueByName.entries()).sort((a, b) => b[1] - a[1])[0];

  return recommendationsFrom(
    {
      health,
      dowRevenue: Array.from(dowMap.entries()).map(([dow, total]) => ({ dow, total })),
      hourCounts: Array.from(hourMap.entries()).map(([hour, count]) => ({ hour, count })),
      topEarner: topEarnerEntry ? { name: topEarnerEntry[0], revenue: topEarnerEntry[1] } : null,
    },
    currency
  );
}
