"use client";

import { createClient } from "@/utils/supabase/client";
import type { Bakery, Bill, BillLine, BillStatus, Item, Log, User } from "./types";
import type { ProfileRow } from "./auth";
import { profileToUser } from "./auth";

// ─── Row shapes (DB) ────────────────────────────────────────────────────────
interface ItemRow {
  id: string;
  name: string;
  emoji: string;
  category: string;
  unit: string;
  price: number;
  cost_price: number | null;
  qty: number;
}
interface BillRow {
  id: string;
  bill_no: number;
  customer_name: string;
  customer_phone: string;
  subtotal: number;
  tax: number;
  total: number;
  tax_rate: number;
  status: "active" | "cancelled";
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}
interface BillItemRow {
  id: string;
  bill_id: string;
  item_id: string | null;
  name: string;
  emoji: string;
  unit: string;
  qty: number;
  price: number;
}
interface LogRow {
  id: string;
  type: Log["type"];
  created_at: string;
  item_id: string | null;
  item_name: string | null;
  qty: number | null;
  supplier: string | null;
  reason: string | null;
  notes: string | null;
  bill_no: number | null;
  items: string | null;
  total: number | null;
  actor_name: string | null;
}
interface SettingsRow {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  gst: string;
  logo_url: string | null;
  currency: string;
  tax_rate: number;
  low_stock_alert: number;
}

// ─── Mappers (DB row → app type) ────────────────────────────────────────────
const mapItem = (r: ItemRow): Item => ({
  id: r.id,
  name: r.name,
  emoji: r.emoji,
  category: r.category,
  unit: r.unit,
  price: r.price,
  costPrice: r.cost_price ?? 0,
  qty: r.qty,
});

const mapLine = (r: BillItemRow): BillLine => ({
  itemId: r.item_id ?? "",
  name: r.name,
  emoji: r.emoji,
  unit: r.unit,
  qty: r.qty,
  price: r.price,
  costPrice: 0, // cost is never fetched into the client; analytics uses item cost
});

const mapBill = (r: BillRow, lines: BillLine[]): Bill => ({
  id: r.id,
  billNo: r.bill_no,
  customerName: r.customer_name,
  customerPhone: r.customer_phone,
  items: lines,
  subtotal: r.subtotal,
  tax: r.tax,
  total: r.total,
  taxRate: r.tax_rate,
  date: r.created_at,
  status: r.status,
  cancelledAt: r.cancelled_at ?? undefined,
  cancelledBy: r.cancelled_by ?? undefined,
});

const mapLog = (r: LogRow): Log => ({
  id: r.id,
  type: r.type,
  date: r.created_at,
  itemId: r.item_id ?? undefined,
  itemName: r.item_name ?? undefined,
  qty: r.qty ?? undefined,
  supplier: r.supplier ?? undefined,
  reason: r.reason ?? undefined,
  notes: r.notes ?? undefined,
  billNo: r.bill_no ?? undefined,
  items: r.items ?? undefined,
  total: r.total ?? undefined,
  user: r.actor_name ?? undefined,
});

const mapBakery = (r: SettingsRow): Bakery => ({
  name: r.name,
  tagline: r.tagline,
  address: r.address,
  phone: r.phone,
  gst: r.gst,
  logo: r.logo_url,
  currency: r.currency,
  taxRate: r.tax_rate,
  lowStockAlert: r.low_stock_alert,
});

// ─── Row → app helpers ───────────────────────────────────────────────────────
const linesByBillId = (rows: BillItemRow[]): Map<string, BillLine[]> => {
  const m = new Map<string, BillLine[]>();
  for (const row of rows) {
    const arr = m.get(row.bill_id) ?? [];
    arr.push(mapLine(row));
    m.set(row.bill_id, arr);
  }
  return m;
};

// ─── Fetchers ───────────────────────────────────────────────────────────────
export interface BaseData {
  bakery: Bakery;
  items: Item[];
}

/**
 * Data the whole app is hydrated with: store profile + the item catalogue.
 * Bounded (one settings row + a bakery's items), so it is safe to load eagerly
 * and refresh after mutations. Bills / logs are NOT loaded here — the dashboard
 * reads server-side aggregates and History paginates. See `fetchDashboardStats`
 * / `fetchBillsPage` / `fetchLogsPage`.
 */
export async function fetchBaseData(): Promise<BaseData> {
  const supabase = createClient();
  const [settingsRes, itemsRes] = await Promise.all([
    supabase.from("store_settings").select("*").eq("id", 1).single(),
    supabase.from("items_v").select("*").order("created_at"),
  ]);
  if (!settingsRes.data) {
    throw new Error("Store settings not found in Supabase");
  }
  return {
    bakery: mapBakery(settingsRes.data as SettingsRow),
    items: ((itemsRes.data ?? []) as ItemRow[]).map(mapItem),
  };
}

export interface FullStoreData extends BaseData {
  bills: Bill[];
  logs: Log[];
}

/**
 * Full history fetch — every bill, line and log. Unbounded, so it is used ONLY
 * by the on-demand Excel export (an explicit, infrequent user action), never on
 * hydration or after mutations.
 */
export async function fetchReportData(): Promise<FullStoreData> {
  const supabase = createClient();
  const base = await fetchBaseData();
  const [billsRes, billItemsRes, logsRes] = await Promise.all([
    supabase.from("bills").select("*").order("created_at"),
    // Explicit columns — cost_price is revoked from the client role (see 0002).
    supabase.from("bill_items").select("id,bill_id,item_id,name,emoji,unit,qty,price"),
    supabase.from("activity_log_v").select("*").order("created_at", { ascending: false }),
  ]);

  const linesByBill = linesByBillId((billItemsRes.data ?? []) as BillItemRow[]);
  return {
    ...base,
    bills: ((billsRes.data ?? []) as BillRow[]).map((b) =>
      mapBill(b, linesByBill.get(b.id) ?? []),
    ),
    logs: ((logsRes.data ?? []) as LogRow[]).map(mapLog),
  };
}

// ─── Dashboard aggregates (server-computed, bounded) ─────────────────────────
export interface DashboardStats {
  today: string;
  kpis: { todaySales: number; yesterdaySales: number; billsToday: number; itemsSoldToday: number };
  /** Per-day active-sales totals for (up to) the last 7 local days. */
  weekly: { date: string; total: number }[];
  topItems: { name: string; qty: number }[];
  /** cogs is null for users without the analytics permission. */
  categories: { category: string; revenue: number; cogs: number | null }[];
  soldByItem: { itemId: string; qty: number }[];
  daySpan: number;
  dowRevenue: { dow: number; total: number }[];
  hourCounts: { hour: number; count: number }[];
  topEarner: { name: string; revenue: number } | null;
  recentBills: {
    id: string; billNo: number; customerName: string;
    total: number; status: BillStatus; date: string;
  }[];
}

/** Fetch the pre-aggregated dashboard payload for the client's local timezone. */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return rpc<DashboardStats>("dashboard_stats", { p_tz: tz });
}

// ─── Paginated history ───────────────────────────────────────────────────────
export interface BillsPage {
  bills: Bill[];
  hasMore: boolean;
}

/** One page of bills (newest first) with their line items. */
export async function fetchBillsPage(offset: number, limit: number): Promise<BillsPage> {
  const supabase = createClient();
  const { data: billRows } = await supabase
    .from("bills")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const rows = (billRows ?? []) as BillRow[];
  if (rows.length === 0) return { bills: [], hasMore: false };

  const { data: lineRows } = await supabase
    .from("bill_items")
    .select("id,bill_id,item_id,name,emoji,unit,qty,price")
    .in("bill_id", rows.map((r) => r.id));
  const linesByBill = linesByBillId((lineRows ?? []) as BillItemRow[]);

  return {
    bills: rows.map((b) => mapBill(b, linesByBill.get(b.id) ?? [])),
    hasMore: rows.length === limit,
  };
}

/** A single bill with its line items — for on-demand viewing (e.g. dashboard). */
export async function fetchBill(id: string): Promise<Bill | null> {
  const supabase = createClient();
  const { data: billRow } = await supabase.from("bills").select("*").eq("id", id).single();
  if (!billRow) return null;
  const { data: lineRows } = await supabase
    .from("bill_items")
    .select("id,bill_id,item_id,name,emoji,unit,qty,price")
    .eq("bill_id", id);
  return mapBill(billRow as BillRow, ((lineRows ?? []) as BillItemRow[]).map(mapLine));
}

export interface LogsPage {
  logs: Log[];
  hasMore: boolean;
}

/** One page of activity-log entries (newest first). */
export async function fetchLogsPage(offset: number, limit: number): Promise<LogsPage> {
  const supabase = createClient();
  const { data } = await supabase
    .from("activity_log_v")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const rows = (data ?? []) as LogRow[];
  return { logs: rows.map(mapLog), hasMore: rows.length === limit };
}

export async function fetchStaff(): Promise<User[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,user_id,name,role,perm_sales,perm_inventory,perm_analytics")
    .order("created_at");
  return ((data ?? []) as ProfileRow[]).map(profileToUser);
}

// ─── RPC wrappers ───────────────────────────────────────────────────────────
/** Throws with a clean message on RPC error. */
async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface ItemInputDb {
  name: string; emoji: string; category: string; unit: string;
  price: number; costPrice: number; qty: number;
}

export const rpcCreateItem = (p: ItemInputDb) =>
  rpc<{ kind: "added" | "merged"; name?: string; qty?: number; unit?: string }>(
    "create_item", { p },
  );
export const rpcUpdateItem = (id: string, p: ItemInputDb) =>
  rpc<void>("update_item", { p_id: id, p });
export const rpcDeleteItem = (id: string) => rpc<void>("delete_item", { p_id: id });

export const rpcStockIn = (itemId: string, qty: number, supplier: string, notes: string) =>
  rpc<void>("stock_in", { p_item: itemId, p_qty: qty, p_supplier: supplier, p_notes: notes });
export const rpcStockOut = (itemId: string, qty: number, reason: string, notes: string) =>
  rpc<void>("stock_out", { p_item: itemId, p_qty: qty, p_reason: reason, p_notes: notes });

interface GeneratedBillRow {
  id: string; bill_no: number; subtotal: number; tax: number;
  total: number; tax_rate: number; created_at: string;
}
export const rpcGenerateBill = (
  customer: { name: string; phone: string },
  lines: { itemId: string; qty: number }[],
) => rpc<GeneratedBillRow>("generate_bill", { customer, lines });

export const rpcCancelBill = (id: string, by: string) =>
  rpc<void>("cancel_bill", { p_id: id, p_by: by });
export const rpcDeleteBill = (id: string, by: string) =>
  rpc<void>("delete_bill", { p_id: id, p_by: by });

export const rpcSaveSettings = (p: {
  name: string; tagline: string; address: string; phone: string;
  gst: string; currency: string; taxRate: number; lowStockAlert: number;
}) => rpc<void>("save_settings", { p });
export const rpcUpdateLogo = (url: string | null) => rpc<void>("update_logo", { p_url: url });
export const rpcClearAllData = () => rpc<void>("clear_all_data", {});
