"use client";

import { createClient } from "@/utils/supabase/client";
import type { Bakery, Batch, Bill, BillLine, BillStatus, Customer, Item, Log, PaymentMethod, StoreLists, User } from "./types";
import type { ProfileRow } from "./auth";
import { profileToUser } from "./auth";
import type { DateRange } from "./date-range";

// ─── Row shapes (DB) ────────────────────────────────────────────────────────
interface ItemRow {
  id: string;
  name: string;
  emoji: string;
  image_url: string | null;
  category: string;
  unit: string;
  price: number;
  cost_price: number | null;
  qty: number;
  tracks_expiry: boolean;
  earliest_expiry: string | null;
  batches: { qty: number | string; expiryDate: string | null }[] | null;
}
interface BillRow {
  id: string;
  bill_no: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  subtotal: number;
  tax: number;
  total: number;
  tax_rate: number;
  payment_method: "Cash" | "UPI";
  discount_percent: number;
  discount_type: "percent" | "flat";
  discount_amount: number;
  status: "active" | "cancelled";
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  biller_name: string | null; // joined from profiles via created_by (bills_v)
}
interface BillItemRow {
  id: string;
  bill_id: string;
  item_id: string | null;
  name: string;
  emoji: string;
  image_url: string | null;
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
interface CustomerRow {
  id: string;
  phone: string;
  name: string;
  first_seen: string;
  visit_count: number | string;
  total_spend: number | string;
  last_purchase: string | null;
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
  expiring_soon_days: number;
  is_open: boolean;
  status_changed_at: string | null;
  status_changed_by: string;
}
interface BatchRow {
  id: string;
  item_id: string;
  qty: number | string;
  expiry_date: string | null;
  created_at: string;
}

// ─── Mappers (DB row → app type) ────────────────────────────────────────────
export const mapItem = (r: ItemRow): Item => ({
  id: r.id,
  name: r.name,
  emoji: r.emoji,
  imageUrl: r.image_url,
  category: r.category,
  unit: r.unit,
  price: r.price,
  costPrice: r.cost_price ?? 0,
  qty: r.qty,
  tracksExpiry: r.tracks_expiry,
  earliestExpiry: r.earliest_expiry,
  batches: (r.batches ?? []).map((b) => ({ qty: Number(b.qty), expiryDate: b.expiryDate })),
});

const mapLine = (r: BillItemRow): BillLine => ({
  itemId: r.item_id ?? "",
  name: r.name,
  emoji: r.emoji,
  imageUrl: r.image_url,
  unit: r.unit,
  qty: r.qty,
  price: r.price,
  costPrice: 0, // cost is never fetched into the client; analytics uses item cost
});

export const mapBill = (r: BillRow, lines: BillLine[]): Bill => ({
  id: r.id,
  billNo: r.bill_no,
  customerId: r.customer_id ?? undefined,
  customerName: r.customer_name,
  customerPhone: r.customer_phone,
  items: lines,
  subtotal: r.subtotal,
  tax: r.tax,
  total: r.total,
  taxRate: r.tax_rate,
  paymentMethod: r.payment_method,
  discountPercent: r.discount_percent,
  discountType: r.discount_type,
  discountAmount: r.discount_amount,
  billerName: r.biller_name ?? "",
  date: r.created_at,
  status: r.status,
  cancelledAt: r.cancelled_at ?? undefined,
  cancelledBy: r.cancelled_by ?? undefined,
});

// visit_count / total_spend arrive as bigint/numeric — Postgres serialises those
// as strings over the wire, so coerce with Number().
export const mapCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  phone: r.phone,
  name: r.name,
  firstSeen: r.first_seen,
  visitCount: Number(r.visit_count),
  totalSpend: Number(r.total_spend),
  lastPurchase: r.last_purchase,
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
  expiringSoonDays: r.expiring_soon_days,
  isOpen: r.is_open,
  statusChangedAt: r.status_changed_at,
  statusChangedBy: r.status_changed_by,
});

const mapBatch = (r: BatchRow): Batch => ({
  id: r.id,
  itemId: r.item_id,
  qty: Number(r.qty),
  expiryDate: r.expiry_date,
  createdAt: r.created_at,
});

interface StoreListRow { kind: string; value: string }

const LIST_KEYS: Record<string, keyof StoreLists> = {
  category: "categories",
  emoji: "emojis",
  unit: "units",
  reason: "reasons",
};

/** Group pre-ordered store_lists rows into the app-facing StoreLists shape. */
export const groupLists = (rows: StoreListRow[]): StoreLists => {
  const lists: StoreLists = { categories: [], emojis: [], units: [], reasons: [] };
  for (const r of rows) {
    const key = LIST_KEYS[r.kind];
    if (key) lists[key].push(r.value);
  }
  return lists;
};

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
  lists: StoreLists;
}

/**
 * Data the whole app is hydrated with: store profile + the item catalogue.
 * Bounded (one settings row + a bakery's items), so it is safe to load eagerly
 * and refresh after mutations. Bills / logs are NOT loaded here — the dashboard
 * reads server-side aggregates and History paginates. See `fetchDashboardStats`
 * / `fetchBillsPage` / `fetchLogsPage`.
 */
export async function fetchItems(): Promise<Item[]> {
  const supabase = createClient();
  const { data } = await supabase.from("items_v").select("*").order("created_at");
  return ((data ?? []) as ItemRow[]).map(mapItem);
}

export async function fetchSettings(): Promise<Bakery> {
  const supabase = createClient();
  const { data } = await supabase.from("store_settings").select("*").eq("id", 1).single();
  if (!data) throw new Error("Store settings not found in Supabase");
  return mapBakery(data as SettingsRow);
}

export async function fetchLists(): Promise<StoreLists> {
  const supabase = createClient();
  const { data } = await supabase
    .from("store_lists")
    .select("kind,value")
    .order("kind")
    .order("sort_order");
  return groupLists((data ?? []) as StoreListRow[]);
}

export async function fetchBaseData(): Promise<BaseData> {
  const [bakery, items, lists] = await Promise.all([
    fetchSettings(),
    fetchItems(),
    fetchLists(),
  ]);
  return { bakery, items, lists };
}

export interface FullStoreData extends BaseData {
  bills: Bill[];
  logs: Log[];
  customers: Customer[];
}

/**
 * Full history fetch — every bill, line and log. Unbounded, so it is used ONLY
 * by the on-demand Excel export (an explicit, infrequent user action), never on
 * hydration or after mutations.
 */
export async function fetchReportData(): Promise<FullStoreData> {
  const supabase = createClient();
  const base = await fetchBaseData();
  const [billsRes, billItemsRes, logsRes, costRes, custRows] = await Promise.all([
    supabase.from("bills_v").select("*").order("created_at"),
    // Explicit columns — cost_price is revoked from the client role (see 0002).
    supabase.from("bill_items").select("id,bill_id,item_id,name,emoji,image_url,unit,qty,price"),
    supabase.from("activity_log_v").select("*").order("created_at", { ascending: false }),
    // Historical per-line cost (analytics-gated SECURITY DEFINER; see 0005), so
    // the report's COGS/profit match the dashboard. Empty for non-analytics users.
    supabase.rpc("bill_lines_with_cost"),
    rpc<CustomerRow[]>("customers_with_stats", {}),
  ]);

  const costById = new Map<string, number>();
  for (const r of (costRes.data ?? []) as { id: string; cost_price: number }[]) {
    costById.set(r.id, r.cost_price);
  }

  const linesByBill = new Map<string, BillLine[]>();
  for (const row of (billItemsRes.data ?? []) as BillItemRow[]) {
    const arr = linesByBill.get(row.bill_id) ?? [];
    arr.push({ ...mapLine(row), costPrice: costById.get(row.id) ?? 0 });
    linesByBill.set(row.bill_id, arr);
  }

  return {
    ...base,
    bills: ((billsRes.data ?? []) as BillRow[]).map((b) =>
      mapBill(b, linesByBill.get(b.id) ?? []),
    ),
    logs: ((logsRes.data ?? []) as LogRow[]).map(mapLog),
    customers: (custRows ?? []).map(mapCustomer),
  };
}

export interface ReportCounts {
  billsInRange: number;
  logsInRange: number;
  items: number;
  customers: number;
}

/**
 * Cheap preview counts for the Reports page — HEAD count queries only, so the
 * page no longer downloads the entire store on mount just to show "N bills".
 * The heavy fetchReportData() is deferred to the Download click.
 *
 * Range bounds mirror excel.ts `inRange` (which compares the UTC calendar day of
 * created_at), so the preview matches what the export will actually include.
 */
export async function fetchReportCounts(range: DateRange): Promise<ReportCounts> {
  const supabase = createClient();
  const withRange = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T): T => {
    let out = q;
    if (range.from) out = out.gte("created_at", `${range.from}T00:00:00.000Z`);
    if (range.to) out = out.lte("created_at", `${range.to}T23:59:59.999Z`);
    return out;
  };
  const [bills, logs, items, customers] = await Promise.all([
    withRange(supabase.from("bills_v").select("*", { count: "exact", head: true })),
    withRange(supabase.from("activity_log_v").select("*", { count: "exact", head: true })),
    supabase.from("items").select("*", { count: "exact", head: true }),
    supabase.from("customers").select("*", { count: "exact", head: true }),
  ]);
  return {
    billsInRange: bills.count ?? 0,
    logsInRange: logs.count ?? 0,
    items: items.count ?? 0,
    customers: customers.count ?? 0,
  };
}

// ─── Dashboard aggregates (server-computed, bounded) ─────────────────────────
export interface DashboardStats {
  today: string;
  kpis: {
    rangeSales: number;
    prevSales: number;
    billsInRange: number;
    prevBills: number;
    itemsSold: number;
    prevItemsSold: number;
  };
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

/** Fetch the pre-aggregated dashboard payload for a date range (client tz). */
export async function fetchDashboardStats(range: DateRange): Promise<DashboardStats> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return rpc<DashboardStats>("dashboard_stats", {
    p_tz: tz,
    p_from: range.from,
    p_to: range.to,
  });
}

// ─── Paginated history ───────────────────────────────────────────────────────
export interface BillsPage {
  bills: Bill[];
  hasMore: boolean;
}

export interface BillFilters {
  q?: string; // numeric → exact bill_no; text → customer_name contains
  status?: BillStatus;
  from?: string | null; // local YYYY-MM-DD (inclusive)
  to?: string | null; // local YYYY-MM-DD (inclusive)
}

// Local calendar-day bounds → UTC instants, so a timestamptz column filters by
// the user's day, not the server's.
const dayStartISO = (ymd: string) => new Date(`${ymd}T00:00:00`).toISOString();
const dayEndISO = (ymd: string) => new Date(`${ymd}T23:59:59.999`).toISOString();

/** One page of bills (newest first) with their line items, filtered server-side
 *  so search / status / date reach the whole history, not just loaded rows. */
export async function fetchBillsPage(
  offset: number,
  limit: number,
  filters: BillFilters = {},
): Promise<BillsPage> {
  const supabase = createClient();
  let query = supabase.from("bills_v").select("*").order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("created_at", dayStartISO(filters.from));
  if (filters.to) query = query.lte("created_at", dayEndISO(filters.to));
  const q = filters.q?.trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      // Pure number → match the bill number exactly (typing "10" finds #10, not
      // #10/#100/#101), still OR-matching names that contain the digits.
      query = query.or(`bill_no.eq.${q},customer_name.ilike.*${q}*`);
    } else {
      query = query.ilike("customer_name", `%${q}%`);
    }
  }
  const { data: billRows } = await query.range(offset, offset + limit - 1);
  const rows = (billRows ?? []) as BillRow[];
  if (rows.length === 0) return { bills: [], hasMore: false };

  const { data: lineRows } = await supabase
    .from("bill_items")
    .select("id,bill_id,item_id,name,emoji,image_url,unit,qty,price")
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
  const { data: billRow } = await supabase.from("bills_v").select("*").eq("id", id).single();
  if (!billRow) return null;
  const { data: lineRows } = await supabase
    .from("bill_items")
    .select("id,bill_id,item_id,name,emoji,image_url,unit,qty,price")
    .eq("bill_id", id);
  return mapBill(billRow as BillRow, ((lineRows ?? []) as BillItemRow[]).map(mapLine));
}

// ─── Customers ────────────────────────────────────────────────────────────
/** Directory + analytics: every customer with computed visit/spend totals. */
export async function fetchCustomers(): Promise<Customer[]> {
  const rows = await rpc<CustomerRow[]>("customers_with_stats", {});
  return (rows ?? []).map(mapCustomer);
}

/** Correct a mistyped customer name/phone. Throws on a phone collision. */
export const rpcUpdateCustomer = (id: string, name: string, phone: string) =>
  rpc<{ id: string; name: string; phone: string }>("update_customer", {
    p_id: id, p_name: name, p_phone: phone,
  });

/**
 * Look a customer up by exact phone for billing autofill. Best-effort: returns
 * null on miss and never throws to the UI (a failed lookup must not block a bill).
 * Filters on the indexed `customers.phone` server-side (not a full-table
 * aggregate) so the returning-customer chip gets the visit count in the same
 * round-trip; fires only once per completed phone.
 *
 * The catch-all below is a deliberate tradeoff, not an accident: it also
 * swallows genuine RLS/network errors as "no such customer." Keep that
 * intentional here — don't copy this pattern to a call site where a failure
 * needs to be distinguishable from "not found" (see the Dashboard/Customers
 * fetch-error handling, which surfaces failures instead of masking them).
 */
export async function fetchCustomerByPhone(phone: string): Promise<Customer | null> {
  try {
    const rows = await rpc<CustomerRow[]>("customer_by_phone", { p_phone: phone });
    return (rows ?? []).map(mapCustomer)[0] ?? null;
  } catch {
    return null;
  }
}

/** All of one customer's bills (with line items), newest first. */
export async function fetchCustomerBills(customerId: string): Promise<Bill[]> {
  const supabase = createClient();
  const { data: billRows } = await supabase
    .from("bills_v")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  const rows = (billRows ?? []) as BillRow[];
  if (rows.length === 0) return [];

  const { data: lineRows } = await supabase
    .from("bill_items")
    .select("id,bill_id,item_id,name,emoji,image_url,unit,qty,price")
    .in("bill_id", rows.map((r) => r.id));
  const linesByBill = linesByBillId((lineRows ?? []) as BillItemRow[]);

  return rows.map((b) => mapBill(b, linesByBill.get(b.id) ?? []));
}

/** One item's batches, soonest-expiry first (NULL-expiry last). For the item editor. */
export async function fetchItemBatches(itemId: string): Promise<Batch[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("stock_batches")
    .select("id,item_id,qty,expiry_date,created_at")
    .eq("item_id", itemId)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  return ((data ?? []) as BatchRow[]).map(mapBatch);
}

export interface LogsPage {
  logs: Log[];
  hasMore: boolean;
}

export interface LogFilters {
  q?: string; // matches item name / actor / notes
  type?: Log["type"] | "all";
  from?: string | null; // local YYYY-MM-DD (inclusive)
  to?: string | null; // local YYYY-MM-DD (inclusive)
}

// Escape the PostgREST `.or()` grammar chars so a user query can't break it.
const orSafe = (s: string) => s.replace(/[,()*]/g, " ").trim();

const STOCK_LOG_TYPES: Log["type"][] = ["in", "out", "bill", "cancel", "delete"];

/** One page of stock/bill movement log entries (newest first), filtered
 *  server-side. Store & staff audit events live in the Owner-only Store tab. */
export async function fetchLogsPage(
  offset: number,
  limit: number,
  filters: LogFilters = {},
): Promise<LogsPage> {
  const supabase = createClient();
  let query = supabase.from("activity_log_v").select("*");
  query =
    filters.type && filters.type !== "all"
      ? query.eq("type", filters.type)
      : query.in("type", STOCK_LOG_TYPES);
  if (filters.from) query = query.gte("created_at", dayStartISO(filters.from));
  if (filters.to) query = query.lte("created_at", dayEndISO(filters.to));
  const q = filters.q ? orSafe(filters.q) : "";
  if (q) query = query.or(`item_name.ilike.*${q}*,actor_name.ilike.*${q}*,notes.ilike.*${q}*`);
  const { data } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const rows = (data ?? []) as LogRow[];
  return { logs: rows.map(mapLog), hasMore: rows.length === limit };
}

/** One page of administrative audit entries (store settings, staff, passwords,
 *  open/close) for the Owner-only Store tab, filtered server-side. Returns
 *  nothing for non-owners (the view is gated on is_owner()). */
export async function fetchAdminLogsPage(
  offset: number,
  limit: number,
  filters: LogFilters = {},
): Promise<LogsPage> {
  const supabase = createClient();
  let query = supabase.from("activity_log_admin_v").select("*");
  if (filters.type && filters.type !== "all") query = query.eq("type", filters.type);
  if (filters.from) query = query.gte("created_at", dayStartISO(filters.from));
  if (filters.to) query = query.lte("created_at", dayEndISO(filters.to));
  const q = filters.q ? orSafe(filters.q) : "";
  if (q) query = query.or(`actor_name.ilike.*${q}*,notes.ilike.*${q}*`);
  const { data } = await query
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

/** Raw list rows (with ids) for the Owner's Settings editor. */
export async function fetchListRows(): Promise<{ id: string; kind: string; value: string }[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("store_lists")
    .select("id,kind,value")
    .order("kind")
    .order("sort_order");
  return (data ?? []) as { id: string; kind: string; value: string }[];
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
  name: string; emoji: string; imageUrl: string | null; category: string; unit: string;
  price: number; costPrice: number; qty: number;
  tracksExpiry: boolean; expiryDate: string | null;
}

// The item-scoped RPCs below return the affected items_v row (rather than
// void) so the caller can patch its local item cache without a full reload.
interface CreateItemResult {
  kind: "added" | "merged"; name?: string; qty?: number; unit?: string; item?: ItemRow;
}
export async function rpcCreateItem(
  p: ItemInputDb,
): Promise<{ kind: "added" | "merged"; name?: string; qty?: number; unit?: string; item?: Item }> {
  const r = await rpc<CreateItemResult>("create_item", { p });
  return { ...r, item: r.item ? mapItem(r.item) : undefined };
}
export async function rpcUpdateItem(id: string, p: ItemInputDb): Promise<Item> {
  return mapItem(await rpc<ItemRow>("update_item", { p_id: id, p }));
}
export const rpcDeleteItem = (id: string) => rpc<void>("delete_item", { p_id: id });

/** Persist just an item's image URL (null clears it), returning the patched row. */
export async function rpcSetItemImage(id: string, url: string | null): Promise<Item> {
  return mapItem(await rpc<ItemRow>("set_item_image", { p_id: id, p_url: url }));
}

export async function rpcStockIn(
  itemId: string, qty: number, supplier: string, notes: string, expiry: string | null,
): Promise<Item> {
  return mapItem(
    await rpc<ItemRow>("stock_in", {
      p_item: itemId, p_qty: qty, p_supplier: supplier, p_notes: notes, p_expiry: expiry,
    }),
  );
}
export async function rpcStockOut(
  itemId: string, qty: number, reason: string, notes: string,
): Promise<Item> {
  return mapItem(
    await rpc<ItemRow>("stock_out", { p_item: itemId, p_qty: qty, p_reason: reason, p_notes: notes }),
  );
}
export async function rpcWriteOffBatch(batchId: string): Promise<Item> {
  return mapItem(await rpc<ItemRow>("write_off_batch", { p_batch_id: batchId }));
}
export async function rpcUpdateBatchExpiry(batchId: string, expiry: string): Promise<Item> {
  return mapItem(
    await rpc<ItemRow>("update_batch_expiry", { p_batch_id: batchId, p_expiry: expiry }),
  );
}

interface GeneratedBillRow {
  id: string; bill_no: number; subtotal: number; tax: number;
  total: number; tax_rate: number; created_at: string;
  discount_percent: number; discount_type: "percent" | "flat"; discount_amount: number;
}
export const rpcGenerateBill = (
  customer: {
    name: string; phone: string; payment: PaymentMethod;
    discount: number; discountType: "percent" | "flat";
  },
  lines: { itemId: string; qty: number }[],
) => {
  // Timezone drives which batches count as expired server-side — must match the
  // client's day-granularity expiryStatus (same convention as dashboard_stats).
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return rpc<GeneratedBillRow>("generate_bill", { customer, lines, p_tz: tz });
};

export const rpcCancelBill = (id: string, by: string) =>
  rpc<void>("cancel_bill", { p_id: id, p_by: by });
export const rpcDeleteBill = (id: string, by: string) =>
  rpc<void>("delete_bill", { p_id: id, p_by: by });

export const rpcSaveSettings = (p: {
  name: string; tagline: string; address: string; phone: string;
  gst: string; currency: string; taxRate: number; lowStockAlert: number;
  expiringSoonDays: number;
}) => rpc<void>("save_settings", { p });
export const rpcSetStoreStatus = (open: boolean, by: string) =>
  rpc<void>("set_store_status", { p_open: open, p_by: by });
export const rpcUpdateLogo = (url: string | null) => rpc<void>("update_logo", { p_url: url });
export const rpcClearAllData = () => rpc<void>("clear_all_data", {});

export const rpcAddListValue = (kind: string, value: string) =>
  rpc<void>("add_list_value", { p_kind: kind, p_value: value });
export const rpcDeleteListValue = (id: string) =>
  rpc<void>("delete_list_value", { p_id: id });
