"use client";

import { createClient } from "@/utils/supabase/client";
import type { Attendance, AttendanceStatus, AttendanceSummary, AdvanceBalance, Bakery, Batch, Bill, BillLine, BillStatus, CashAccount, CashCategory, CashDay, CashDayStatus, CashDaySummary, CashDirection, CashEntry, CashEntryFilters, CashEntryStatus, CashPaymentMode, CashSourceType, CashbookSummary, Customer, Employee, EmployeeSalary, Item, Log, PaymentMethod, PayrollRow, SalaryMode, SalaryPayment, StaffAdvance, StoreLists, Supplier, SupplierProduct, SupplierStatus, InvoiceStatus, PurchaseInvoice, PurchaseInvoiceLine, PurchaseMode, PurchaseReturn, PurchaseReturnLine, SupplierPayment, SupplierSummary, User } from "./types";
import type { SupplierInput } from "./supplier";
import { isPurchaseMode, type DraftLine } from "./purchase";
import { isAttendanceStatus } from "./attendance";
import { isSalaryMode } from "./salary";
import type { ProfileRow } from "./auth";
import { PROFILE_COLUMNS, profileToUser } from "./auth";
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
  // Source columns arrive from stock_batches_v (migration 0040). Optional so a
  // caller reading the bare table still type-checks.
  supplier_id?: string | null;
  supplier_name?: string | null;
  supplier_code?: string | null;
  source_ref?: string | null;
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
  supplierId: r.supplier_id ?? null,
  supplierName: r.supplier_name ?? null,
  supplierCode: r.supplier_code ?? null,
  sourceRef: r.source_ref ?? null,
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

/**
 * One item's batches, soonest-expiry first (NULL-expiry last). For the item
 * editor. Reads `stock_batches_v` rather than the table so each batch carries
 * the supplier it came from (migration 0040).
 */
export async function fetchItemBatches(itemId: string): Promise<Batch[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("stock_batches_v")
    .select("*")
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
    .select(PROFILE_COLUMNS)
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

interface GeneratedBillPayload {
  bill: BillRow;
  items: BillItemRow[];
}
/**
 * `clientRef` is the idempotency key for one checkout attempt. Reusing it on a
 * retry returns the bill that already committed instead of ringing up a second
 * one, which is what a lost response over flaky counter wifi used to cause.
 *
 * The returned bill is built from the stored rows, not from the caller's cart,
 * so the receipt lines can never disagree with the total the customer paid.
 */
export const rpcGenerateBill = async (
  customer: {
    name: string; phone: string; payment: PaymentMethod;
    discount: number; discountType: "percent" | "flat";
  },
  lines: { itemId: string; qty: number }[],
  clientRef: string,
): Promise<Bill> => {
  // Timezone drives which batches count as expired server-side — must match the
  // client's day-granularity expiryStatus (same convention as dashboard_stats).
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const res = await rpc<GeneratedBillPayload>("generate_bill", {
    customer, lines, p_tz: tz, p_client_ref: clientRef,
  });
  return mapBill(res.bill, res.items.map(mapLine));
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

// ─── Attendance ─────────────────────────────────────────────────────────────

interface AttendanceRow {
  id: string;
  profile_id: string;
  on_date: string;
  status: string;
  note: string | null;
  updated_at: string;
  employee_name: string;
  marked_by_name: string | null;
}

/**
 * Returns null for a row whose status isn't in the catalogue. The DB check
 * constraint makes that unreachable, but there is no longer a safe fallback to
 * substitute — inventing a status would silently change someone's payable days —
 * so such a row is dropped rather than guessed at.
 */
function mapAttendance(r: AttendanceRow): Attendance | null {
  if (!isAttendanceStatus(r.status)) return null;
  return {
    id: r.id,
    profileId: r.profile_id,
    employeeName: r.employee_name,
    date: r.on_date,
    status: r.status,
    note: r.note ?? "",
    markedByName: r.marked_by_name ?? "",
    updatedAt: r.updated_at,
  };
}

/** Map a batch of rows, dropping any that can't be interpreted. */
const mapAttendanceRows = (rows: AttendanceRow[]): Attendance[] =>
  rows.map(mapAttendance).filter((r): r is Attendance => r !== null);

/**
 * Everyone attendance can be recorded against, name only. The RPC already
 * excludes the Owner and orders by name.
 */
export async function fetchEmployees(): Promise<Employee[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("attendance_roster");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string }[]).map((r) => ({
    id: r.id,
    name: r.name,
  }));
}

export interface AttendanceFilters {
  from: string | null;
  to: string | null;
  profileId: string | null;
  status: AttendanceStatus | null;
}

/** Records for a single day — what the marking screen reads. */
export async function fetchAttendanceForDate(date: string): Promise<Attendance[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("attendance_v")
    .select("*")
    .eq("on_date", date);
  if (error) throw new Error(error.message);
  return mapAttendanceRows((data ?? []) as AttendanceRow[]);
}

/**
 * Filtered history. Bounded by `limit` so a long range can't pull the whole
 * table into the browser; the caller shows a "showing first N" note when the
 * result comes back full.
 */
export async function fetchAttendance(
  filters: AttendanceFilters,
  limit = 500,
): Promise<Attendance[]> {
  const supabase = createClient();
  let q = supabase.from("attendance_v").select("*");
  if (filters.from) q = q.gte("on_date", filters.from);
  if (filters.to) q = q.lte("on_date", filters.to);
  if (filters.profileId) q = q.eq("profile_id", filters.profileId);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q
    .order("on_date", { ascending: false })
    .order("employee_name")
    .limit(limit);
  if (error) throw new Error(error.message);
  return mapAttendanceRows((data ?? []) as AttendanceRow[]);
}

interface SummaryRow {
  profile_id: string;
  employee_name: string;
  present: number | string;
  half_day: number | string;
  leave_days: number | string;
  holiday: number | string;
  recorded: number | string;
  payable_days: number | string;
  unpaid_days: number | string;
}

/** Server-computed per-employee tallies. `bigint`/`numeric` arrive as strings. */
export async function fetchAttendanceSummary(
  from: string | null,
  to: string | null,
  profileId: string | null = null,
): Promise<AttendanceSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("attendance_summary", {
    p_from: from,
    p_to: to,
    p_profile: profileId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SummaryRow[]).map((r) => ({
    profileId: r.profile_id,
    employeeName: r.employee_name,
    present: Number(r.present),
    halfDay: Number(r.half_day),
    leave: Number(r.leave_days),
    holiday: Number(r.holiday),
    recorded: Number(r.recorded),
    payableDays: Number(r.payable_days),
    unpaidDays: Number(r.unpaid_days),
  }));
}

export async function rpcSetAttendance(
  profileId: string,
  date: string,
  status: AttendanceStatus,
  note = "",
): Promise<Attendance> {
  // Timezone decides what "today" is, so the server's future-date guard agrees
  // with the date the user actually sees (same convention as dashboard_stats).
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const row = await rpc<AttendanceRow>("set_attendance", {
    p_profile: profileId,
    p_date: date,
    p_status: status,
    p_note: note,
    p_tz: tz,
  });
  const mapped = mapAttendance(row);
  // The row we just wrote came from a validated status, so this cannot fail —
  // throwing beats returning a half-built record if it somehow does.
  if (!mapped) throw new Error("Saved attendance came back unreadable");
  return mapped;
}

export const rpcClearAttendance = (profileId: string, date: string) =>
  rpc<void>("clear_attendance", { p_profile: profileId, p_date: date });

// ─── Salary & payroll ───────────────────────────────────────────────────────

/** Everyone on the payroll with their monthly salary (Owner excluded by the RPC). */
export async function fetchEmployeeSalaries(): Promise<EmployeeSalary[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("employee_salaries");
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    profile_id: string; employee_name: string;
    monthly_salary: number | string; updated_at: string | null;
  }[]).map((r) => ({
    profileId: r.profile_id,
    employeeName: r.employee_name,
    monthlySalary: Number(r.monthly_salary),
    updatedAt: r.updated_at,
  }));
}

export const rpcSetEmployeeSalary = (profileId: string, amount: number) =>
  rpc<void>("set_employee_salary", { p_profile: profileId, p_amount: amount });

interface PayrollPreviewRow {
  profile_id: string;
  employee_name: string;
  gross: number | string;
  calendar_days: number | string;
  recorded: number | string;
  unpaid_days: number | string;
  deduction: number | string;
  computed_net: number | string;
  payment_id: string | null;
  status: string;
  net: number | string | null;
  stored_computed_net: number | string | null;
  override_reason: string | null;
  paid_on: string | null;
  payment_mode: string | null;
  advance_balance: number | string | null;
  advance_recovery: number | string | null;
  net_payable: number | string | null;
}

/**
 * The month's payroll, recomputed from live attendance on every call. Numeric
 * and bigint columns arrive as strings over the wire, hence the Number()s.
 */
export async function fetchPayroll(
  year: number,
  month: number,
): Promise<PayrollRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("payroll_preview", {
    p_year: year,
    p_month: month,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PayrollPreviewRow[]).map((r) => ({
    profileId: r.profile_id,
    employeeName: r.employee_name,
    gross: Number(r.gross),
    calendarDays: Number(r.calendar_days),
    recorded: Number(r.recorded),
    unpaidDays: Number(r.unpaid_days),
    deduction: Number(r.deduction),
    computedNet: Number(r.computed_net),
    paymentId: r.payment_id,
    status: r.status === "paid" ? "paid" : r.status === "unpaid" ? "unpaid" : "none",
    net: r.net === null ? null : Number(r.net),
    storedComputedNet:
      r.stored_computed_net === null ? null : Number(r.stored_computed_net),
    overrideReason: r.override_reason ?? "",
    paidOn: r.paid_on,
    paymentMode: isSalaryMode(r.payment_mode) ? r.payment_mode : "",
    advanceBalance: Number(r.advance_balance ?? 0),
    advanceRecovery: Number(r.advance_recovery ?? 0),
    // Falls back to the net when no record exists yet, so the field is never
    // a misleading zero on an unprepared row.
    netPayable: Number(r.net_payable ?? r.net ?? r.computed_net),
  }));
}

interface SalaryPaymentRow {
  id: string;
  profile_id: string;
  employee_name: string;
  period_year: number | string;
  period_month: number | string;
  gross: number | string;
  calendar_days: number | string;
  recorded_days: number | string | null;
  unpaid_days: number | string;
  deduction: number | string;
  computed_net: number | string;
  net: number | string;
  override_reason: string | null;
  status: string;
  paid_on: string | null;
  payment_mode: string | null;
  recorded_by_name: string | null;
  updated_at: string;
  advance_recovery: number | string | null;
  net_payable: number | string | null;
}

function mapSalaryPayment(r: SalaryPaymentRow): SalaryPayment {
  return {
    id: r.id,
    profileId: r.profile_id,
    employeeName: r.employee_name,
    periodYear: Number(r.period_year),
    periodMonth: Number(r.period_month),
    gross: Number(r.gross),
    calendarDays: Number(r.calendar_days),
    recordedDays: r.recorded_days === null ? null : Number(r.recorded_days),
    unpaidDays: Number(r.unpaid_days),
    deduction: Number(r.deduction),
    computedNet: Number(r.computed_net),
    net: Number(r.net),
    overrideReason: r.override_reason ?? "",
    status: r.status === "paid" ? "paid" : "unpaid",
    paidOn: r.paid_on,
    paymentMode: isSalaryMode(r.payment_mode) ? r.payment_mode : "",
    recordedByName: r.recorded_by_name ?? "",
    updatedAt: r.updated_at,
    advanceRecovery: Number(r.advance_recovery ?? 0),
    netPayable: Number(r.net_payable ?? r.net),
  };
}

/** Payment history, newest period first. */
export async function fetchSalaryPayments(
  profileId: string | null = null,
  limit = 300,
): Promise<SalaryPayment[]> {
  const supabase = createClient();
  let q = supabase.from("salary_payment_v").select("*");
  if (profileId) q = q.eq("profile_id", profileId);
  const { data, error } = await q
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .order("employee_name")
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SalaryPaymentRow[]).map(mapSalaryPayment);
}

/** Create or adjust a period's payroll. `net` null takes the computed figure. */
export async function rpcSaveSalaryPayment(
  profileId: string,
  year: number,
  month: number,
  net: number | null = null,
  reason = "",
): Promise<SalaryPayment> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const row = await rpc<SalaryPaymentRow>("save_salary_payment", {
    p_profile: profileId,
    p_year: year,
    p_month: month,
    p_net: net,
    p_reason: reason,
    p_tz: tz,
  });
  return mapSalaryPayment(row);
}

export async function rpcMarkSalaryPaid(
  id: string,
  paidOn: string,
  mode: SalaryMode,
): Promise<SalaryPayment> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const row = await rpc<SalaryPaymentRow>("mark_salary_paid", {
    p_id: id,
    p_paid_on: paidOn,
    p_mode: mode,
    p_tz: tz,
  });
  return mapSalaryPayment(row);
}

export async function rpcMarkSalaryUnpaid(id: string): Promise<SalaryPayment> {
  const row = await rpc<SalaryPaymentRow>("mark_salary_unpaid", { p_id: id });
  return mapSalaryPayment(row);
}

export const rpcDeleteSalaryPayment = (id: string) =>
  rpc<void>("delete_salary_payment", { p_id: id });

// ─── Advances ───────────────────────────────────────────────────────────────

/** Every non-Owner employee's advance position (Owner excluded by the view). */
export async function fetchAdvanceBalances(): Promise<AdvanceBalance[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("staff_advance_balance_v")
    .select("*");
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    profile_id: string; employee_name: string;
    total_advanced: number | string; total_recovered: number | string;
    balance: number | string; pending_amount: number | string;
    oldest_open: string | null; monthly_salary: number | string;
  }[]).map((r) => ({
    profileId: r.profile_id,
    employeeName: r.employee_name,
    totalAdvanced: Number(r.total_advanced),
    totalRecovered: Number(r.total_recovered),
    balance: Number(r.balance),
    pendingAmount: Number(r.pending_amount),
    oldestOpen: r.oldest_open,
    monthlySalary: Number(r.monthly_salary),
  }));
}

interface StaffAdvanceRow {
  id: string;
  profile_id: string;
  employee_name: string;
  amount: number | string;
  note: string | null;
  status: string;
  requested_on: string;
  approved_on: string | null;
  payment_mode: string | null;
  reject_reason: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
  updated_at: string;
}

function mapAdvance(r: StaffAdvanceRow): StaffAdvance {
  return {
    id: r.id,
    profileId: r.profile_id,
    employeeName: r.employee_name,
    amount: Number(r.amount),
    note: r.note ?? "",
    status:
      r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : "pending",
    requestedOn: r.requested_on,
    requestedByName: r.requested_by_name ?? "",
    approvedOn: r.approved_on,
    paymentMode: isSalaryMode(r.payment_mode) ? r.payment_mode : "",
    rejectReason: r.reject_reason ?? "",
    decidedByName: r.decided_by_name ?? "",
    updatedAt: r.updated_at,
  };
}

/** Advances, newest first. Pass a profile id for one employee's ledger. */
export async function fetchAdvances(profileId?: string): Promise<StaffAdvance[]> {
  const supabase = createClient();
  let q = supabase.from("staff_advance_v").select("*");
  if (profileId) q = q.eq("profile_id", profileId);
  const { data, error } = await q
    .order("requested_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as StaffAdvanceRow[]).map(mapAdvance);
}

export async function rpcRequestAdvance(
  profileId: string,
  amount: number,
  note: string,
): Promise<StaffAdvance> {
  const row = await rpc<StaffAdvanceRow>("request_advance", {
    p_profile: profileId,
    p_amount: amount,
    p_note: note,
    p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  return mapAdvance(row);
}

export async function rpcApproveAdvance(
  id: string,
  approvedOn: string,
  mode: SalaryMode,
): Promise<StaffAdvance> {
  const row = await rpc<StaffAdvanceRow>("approve_advance", {
    p_id: id,
    p_approved_on: approvedOn,
    p_mode: mode,
    p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  return mapAdvance(row);
}

export async function rpcRejectAdvance(
  id: string,
  reason: string,
): Promise<StaffAdvance> {
  const row = await rpc<StaffAdvanceRow>("reject_advance", {
    p_id: id,
    p_reason: reason,
  });
  return mapAdvance(row);
}

export const rpcDeleteAdvance = (id: string) =>
  rpc<void>("delete_advance", { p_id: id });

/** Set the recovery on an unpaid payroll record. Gated on `salary.edit`. */
export async function rpcSetAdvanceRecovery(
  paymentId: string,
  amount: number,
): Promise<SalaryPayment> {
  const row = await rpc<SalaryPaymentRow>("set_advance_recovery", {
    p_payment_id: paymentId,
    p_amount: amount,
  });
  return mapSalaryPayment(row);
}

// ─── Suppliers ──────────────────────────────────────────────────────────────

interface SupplierRow {
  id: string;
  code: string;
  supplier_type: string;
  name: string;
  business_name: string | null;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;
  payment_terms: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapSupplier(r: SupplierRow): Supplier {
  return {
    id: r.id,
    code: r.code,
    supplierType: r.supplier_type === "in_house" ? "in_house" : "external",
    name: r.name,
    businessName: r.business_name ?? "",
    contactPerson: r.contact_person ?? "",
    mobile: r.mobile ?? "",
    email: r.email ?? "",
    gstin: r.gstin ?? "",
    address: r.address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    pinCode: r.pin_code ?? "",
    paymentTerms: r.payment_terms ?? "",
    notes: r.notes ?? "",
    status: r.status === "inactive" ? "inactive" : "active",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The jsonb payload both supplier RPCs take. Keys are camelCase by design —
 *  `supplier_fields` in SQL reads them and owns the trimming. */
const supplierPayload = (input: SupplierInput) => ({
  supplierType: input.supplierType,
  name: input.name,
  businessName: input.businessName,
  contactPerson: input.contactPerson,
  mobile: input.mobile,
  email: input.email,
  gstin: input.gstin,
  address: input.address,
  city: input.city,
  state: input.state,
  pinCode: input.pinCode,
  paymentTerms: input.paymentTerms,
  notes: input.notes,
});

/** Every supplier the caller may see, active first then by name. */
export async function fetchSuppliers(): Promise<Supplier[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("suppliers_v")
    .select("*")
    .order("status", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SupplierRow[]).map(mapSupplier);
}

export async function fetchSupplier(id: string): Promise<Supplier | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("suppliers_v")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSupplier(data as SupplierRow) : null;
}

export async function rpcCreateSupplier(input: SupplierInput): Promise<Supplier> {
  return mapSupplier(await rpc<SupplierRow>("create_supplier", { p: supplierPayload(input) }));
}

/**
 * `expectedUpdatedAt` is the `updatedAt` the form loaded. The RPC refuses the
 * write if the stored value has moved, so a concurrent edit surfaces as an
 * error rather than a silent overwrite.
 */
export async function rpcUpdateSupplier(
  id: string,
  input: SupplierInput,
  expectedUpdatedAt: string,
): Promise<Supplier> {
  return mapSupplier(
    await rpc<SupplierRow>("update_supplier", {
      p_id: id,
      p: supplierPayload(input),
      p_expected: expectedUpdatedAt,
    }),
  );
}

export async function rpcSetSupplierStatus(
  id: string,
  status: SupplierStatus,
): Promise<Supplier> {
  return mapSupplier(
    await rpc<SupplierRow>("set_supplier_status", { p_id: id, p_status: status }),
  );
}

interface SupplierProductRow {
  supplier_id: string;
  item_id: string;
  item_name: string;
  emoji: string | null;
  image_url: string | null;
  category: string | null;
  unit: string | null;
  current_qty: number | string | null;
  earliest_expiry: string | null;
  last_unit_cost: number | string | null;
  last_purchase_date: string | null;
  created_at: string;
}

/** Products linked to one supplier, with derived purchase price and date. */
export async function fetchSupplierProducts(supplierId: string): Promise<SupplierProduct[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("supplier_products_v")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("item_name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SupplierProductRow[]).map((r) => ({
    supplierId: r.supplier_id,
    itemId: r.item_id,
    itemName: r.item_name,
    emoji: r.emoji ?? "📦",
    imageUrl: r.image_url,
    category: r.category ?? "",
    unit: r.unit ?? "",
    currentQty: Number(r.current_qty ?? 0),
    earliestExpiry: r.earliest_expiry,
    // Null, not 0: "never purchased" and "purchased at zero" are different
    // facts and the UI renders them differently.
    lastUnitCost: r.last_unit_cost == null ? null : Number(r.last_unit_cost),
    lastPurchaseDate: r.last_purchase_date,
    linkedAt: r.created_at,
  }));
}

export const rpcLinkSupplierItem = (supplierId: string, itemId: string) =>
  rpc<void>("link_supplier_item", { p_supplier: supplierId, p_item: itemId });

export const rpcUnlinkSupplierItem = (supplierId: string, itemId: string) =>
  rpc<void>("unlink_supplier_item", { p_supplier: supplierId, p_item: itemId });

// ─── Purchasing ─────────────────────────────────────────────────────────────

/** Optional supplier + date-range narrowing, shared by all three ledgers. */
export interface LedgerQuery {
  supplierId?: string;
  range?: DateRange;
}

interface InvoiceRow {
  id: string;
  supplier_id: string;
  supplier_type: string;
  supplier_name: string;
  supplier_code: string;
  invoice_no: string | null;
  internal_ref: string | null;
  purchase_date: string;
  status: string;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  subtotal: number | string | null;
  gst_amount: number | string | null;
  total: number | string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  item_id: string;
  item_name: string;
  qty: number | string;
  expiry: string | null;
  returned_qty: number | string | null;
  unit_cost: number | string | null;
  gst_rate: number | string | null;
  line_total: number | string | null;
}

const asStatus = (v: string): InvoiceStatus =>
  v === "posted" ? "posted" : v === "cancelled" ? "cancelled" : "draft";

/** Money reads NULL without `suppliers.financial`; 0 is the honest render. */
const money = (v: number | string | null | undefined): number => Number(v ?? 0);

function mapInvoiceLine(r: InvoiceLineRow): PurchaseInvoiceLine {
  return {
    id: r.id,
    itemId: r.item_id,
    itemName: r.item_name,
    qty: Number(r.qty),
    unitCost: money(r.unit_cost),
    gstRate: money(r.gst_rate),
    lineTotal: money(r.line_total),
    expiry: r.expiry,
    returnedQty: Number(r.returned_qty ?? 0),
  };
}

function mapInvoice(r: InvoiceRow, lines: PurchaseInvoiceLine[]): PurchaseInvoice {
  return {
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierCode: r.supplier_code,
    supplierType: r.supplier_type === "in_house" ? "in_house" : "external",
    invoiceNo: r.invoice_no,
    internalRef: r.internal_ref,
    purchaseDate: r.purchase_date,
    subtotal: money(r.subtotal),
    // Null is meaningful here: an in-house receipt has no GST at all, which the
    // UI renders as "—" rather than "₹0.00".
    gstAmount: r.gst_amount == null ? null : Number(r.gst_amount),
    total: money(r.total),
    status: asStatus(r.status),
    notes: r.notes ?? "",
    createdByName: r.created_by_name ?? "",
    createdAt: r.created_at,
    lines,
    cancelledAt: r.cancelled_at ?? null,
    cancelReason: r.cancel_reason ?? "",
  };
}

const applyLedgerQuery = <T>(q: T, opts: LedgerQuery, dateCol: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let out: any = q;
  if (opts.supplierId) out = out.eq("supplier_id", opts.supplierId);
  if (opts.range?.from) out = out.gte(dateCol, opts.range.from);
  if (opts.range?.to) out = out.lte(dateCol, opts.range.to);
  return out as T;
};

/**
 * Invoice headers, newest first. Lines are NOT fetched — the list shows totals
 * only, and one round trip per row would be a query per screen.
 */
export async function fetchPurchaseInvoices(
  opts: LedgerQuery = {},
): Promise<PurchaseInvoice[]> {
  const supabase = createClient();
  const { data, error } = await applyLedgerQuery(
    supabase.from("purchase_invoice_v").select("*"),
    opts,
    "purchase_date",
  )
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as InvoiceRow[]).map((r) => mapInvoice(r, []));
}

/** One invoice with its lines — for the detail view and the return form. */
export async function fetchPurchaseInvoice(id: string): Promise<PurchaseInvoice | null> {
  const supabase = createClient();
  const [header, lines] = await Promise.all([
    supabase.from("purchase_invoice_v").select("*").eq("id", id).maybeSingle(),
    supabase.from("purchase_invoice_line_v").select("*").eq("invoice_id", id).order("item_name"),
  ]);
  if (header.error) throw new Error(header.error.message);
  if (lines.error) throw new Error(lines.error.message);
  if (!header.data) return null;
  return mapInvoice(
    header.data as InvoiceRow,
    ((lines.data ?? []) as InvoiceLineRow[]).map(mapInvoiceLine),
  );
}

export interface InvoiceDraftInput {
  /** Omit to create; pass to replace an existing draft. */
  id?: string;
  supplierId: string;
  invoiceNo: string;
  purchaseDate: string;
  notes: string;
  lines: DraftLine[];
}

export async function rpcSavePurchaseInvoice(
  draft: InvoiceDraftInput,
): Promise<PurchaseInvoice> {
  const row = await rpc<InvoiceRow>("save_purchase_invoice", {
    p: {
      id: draft.id ?? "",
      supplierId: draft.supplierId,
      invoiceNo: draft.invoiceNo,
      purchaseDate: draft.purchaseDate,
      notes: draft.notes,
      lines: draft.lines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        unitCost: l.unitCost,
        gstRate: l.gstRate,
        expiry: l.expiry ?? "",
      })),
    },
  });
  return mapInvoice(row, []);
}

export async function rpcPostPurchaseInvoice(id: string): Promise<PurchaseInvoice> {
  return mapInvoice(await rpc<InvoiceRow>("post_purchase_invoice", { p_id: id }), []);
}

/**
 * `writeOff` decides what the stock removal MEANS. False treats the invoice as
 * never having happened — the stock is reversed and no movement is logged. True
 * records the quantity as a loss: one `out` movement per line with reason
 * "Write-off", so it shows up in the stock log and the wastage figures. Needs
 * `stock.expiry` on top of `purchases.create`.
 */
export async function rpcCancelPurchaseInvoice(
  id: string,
  reason: string,
  writeOff = false,
): Promise<PurchaseInvoice> {
  return mapInvoice(
    await rpc<InvoiceRow>("cancel_purchase_invoice", {
      p_id: id,
      p_reason: reason,
      p_write_off: writeOff,
    }),
    [],
  );
}

interface PaymentRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  invoice_id: string | null;
  invoice_no: string | null;
  paid_on: string;
  mode: string;
  reference_no: string | null;
  created_by_name: string | null;
  created_at: string;
  amount: number | string | null;
}

const mapPayment = (r: PaymentRow): SupplierPayment => ({
  id: r.id,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  invoiceId: r.invoice_id,
  invoiceNo: r.invoice_no,
  amount: money(r.amount),
  paidOn: r.paid_on,
  mode: isPurchaseMode(r.mode) ? r.mode : "Cash",
  referenceNo: r.reference_no ?? "",
  createdByName: r.created_by_name ?? "",
  createdAt: r.created_at,
});

export async function fetchSupplierPayments(
  opts: LedgerQuery = {},
): Promise<SupplierPayment[]> {
  const supabase = createClient();
  const { data, error } = await applyLedgerQuery(
    supabase.from("supplier_payment_v").select("*"),
    opts,
    "paid_on",
  )
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PaymentRow[]).map(mapPayment);
}

export interface PaymentInput {
  supplierId: string;
  invoiceId: string | null;
  amount: number;
  paidOn: string;
  mode: PurchaseMode;
  referenceNo: string;
  notes: string;
}

export async function rpcRecordSupplierPayment(input: PaymentInput): Promise<SupplierPayment> {
  return mapPayment(
    await rpc<PaymentRow>("record_supplier_payment", {
      p: { ...input, invoiceId: input.invoiceId ?? "" },
    }),
  );
}

export const rpcDeleteSupplierPayment = (id: string) =>
  rpc<void>("delete_supplier_payment", { p_id: id });

interface ReturnRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  invoice_id: string;
  invoice_no: string | null;
  return_date: string;
  status: string;
  reason: string;
  created_by_name: string | null;
  created_at: string;
  total: number | string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

const mapReturn = (r: ReturnRow, lines: PurchaseReturnLine[]): PurchaseReturn => ({
  id: r.id,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  invoiceId: r.invoice_id,
  invoiceNo: r.invoice_no,
  returnDate: r.return_date,
  total: money(r.total),
  status: asStatus(r.status),
  reason: r.reason,
  createdByName: r.created_by_name ?? "",
  createdAt: r.created_at,
  lines,
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: r.cancel_reason ?? "",
});

export async function fetchPurchaseReturns(
  opts: LedgerQuery = {},
): Promise<PurchaseReturn[]> {
  const supabase = createClient();
  const { data, error } = await applyLedgerQuery(
    supabase.from("purchase_return_v").select("*"),
    opts,
    "return_date",
  )
    .order("return_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ReturnRow[]).map((r) => mapReturn(r, []));
}

export interface ReturnInput {
  invoiceId: string;
  returnDate: string;
  reason: string;
  lines: { invoiceLineId: string; qty: number }[];
}

export async function rpcPostPurchaseReturn(input: ReturnInput): Promise<PurchaseReturn> {
  return mapReturn(await rpc<ReturnRow>("post_purchase_return", { p: input }), []);
}

/**
 * Withdraw a posted credit note. The stock goes back under the invoice it
 * arrived on, and the credit disappears from the account summary, which counts
 * posted returns only.
 */
export async function rpcCancelPurchaseReturn(
  id: string,
  reason: string,
): Promise<PurchaseReturn> {
  return mapReturn(
    await rpc<ReturnRow>("cancel_purchase_return", { p_id: id, p_reason: reason }),
    [],
  );
}

interface SummaryRow {
  supplier_id: string;
  supplier_name: string;
  supplier_code: string;
  supplier_type: string;
  total_purchases: number | string;
  total_payments: number | string;
  return_credit: number | string;
  outstanding: number | string;
  in_house_value: number | string;
  last_transaction_date: string | null;
  last_payment_date: string | null;
  purchase_order_count: number | string;
  transaction_count: number | string;
}

const mapSummary = (r: SummaryRow): SupplierSummary => ({
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  supplierCode: r.supplier_code,
  supplierType: r.supplier_type === "in_house" ? "in_house" : "external",
  totalPurchases: Number(r.total_purchases),
  totalPayments: Number(r.total_payments),
  returnCredit: Number(r.return_credit),
  outstanding: Number(r.outstanding),
  inHouseValue: Number(r.in_house_value),
  lastTransactionDate: r.last_transaction_date,
  lastPaymentDate: r.last_payment_date,
  purchaseOrderCount: Number(r.purchase_order_count),
  transactionCount: Number(r.transaction_count),
});

/**
 * Every supplier's account position. Returns an EMPTY array for a caller
 * without `suppliers.financial` — the view yields no rows rather than a row of
 * nulls, so the caller must gate the UI on the permission itself.
 */
export async function fetchSupplierSummaries(): Promise<SupplierSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("supplier_summary_v")
    .select("*")
    .order("supplier_name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SummaryRow[]).map(mapSummary);
}

export async function fetchSupplierSummary(id: string): Promise<SupplierSummary | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("supplier_summary_v")
    .select("*")
    .eq("supplier_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSummary(data as SummaryRow) : null;
}

/**
 * Everything the six supplier reports read, in four round trips.
 *
 * Invoice LINES are fetched in one `in (...)` query keyed by the header ids
 * rather than per invoice — Product-wise Purchases needs every line, and a
 * query per invoice would be a query per row on screen.
 *
 * `shop` is added by the caller from the store, so this stays a pure data fetch.
 */
export async function fetchSupplierReportData(
  range: DateRange,
): Promise<{
  invoices: PurchaseInvoice[];
  payments: SupplierPayment[];
  returns: PurchaseReturn[];
  summaries: SupplierSummary[];
}> {
  const supabase = createClient();
  const [invoices, payments, returns, summaries] = await Promise.all([
    fetchPurchaseInvoices({ range }),
    fetchSupplierPayments({ range }),
    fetchPurchaseReturns({ range }),
    fetchSupplierSummaries(),
  ]);

  const ids = invoices.filter((i) => i.status === "posted").map((i) => i.id);
  if (ids.length === 0) return { invoices, payments, returns, summaries };

  const { data, error } = await supabase
    .from("purchase_invoice_line_v")
    .select("*")
    .in("invoice_id", ids);
  if (error) throw new Error(error.message);

  const byInvoice = new Map<string, PurchaseInvoiceLine[]>();
  for (const r of (data ?? []) as InvoiceLineRow[]) {
    byInvoice.set(r.invoice_id, [...(byInvoice.get(r.invoice_id) ?? []), mapInvoiceLine(r)]);
  }

  return {
    invoices: invoices.map((i) => ({ ...i, lines: byInvoice.get(i.id) ?? [] })),
    payments,
    returns,
    summaries,
  };
}

// ─── Cashbook ───────────────────────────────────────────────────────────────

export interface CashEntryRow {
  id: string;
  on_date: string;
  created_at: string;
  account: string;
  direction: string;
  amount: string | number;
  payment_mode: string;
  category_id: string;
  category_name: string;
  category_group: string | null;
  category_path: string;
  source_type: string;
  source_id: string | null;
  reverses_id: string | null;
  transfer_id: string | null;
  reference_no: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  status: string;
  source_ref: string | null;
  running_balance: string | number;
}

export interface CashCategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  direction: string;
  is_system: boolean;
  sort_order: number;
}

export function mapCashEntry(r: CashEntryRow): CashEntry {
  return {
    id: r.id,
    onDate: r.on_date,
    createdAt: r.created_at,
    account: r.account as CashAccount,
    direction: r.direction as CashDirection,
    // Postgres numeric arrives as a string over the wire.
    amount: Number(r.amount),
    paymentMode: r.payment_mode as CashPaymentMode,
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryGroup: r.category_group ?? "",
    categoryPath: r.category_path,
    sourceType: r.source_type as CashSourceType,
    sourceId: r.source_id,
    sourceRef: r.source_ref ?? "",
    reversesId: r.reverses_id,
    transferId: r.transfer_id,
    referenceNo: r.reference_no ?? "",
    note: r.note ?? "",
    createdById: r.created_by,
    createdByName: r.created_by_name ?? "",
    status: r.status as CashEntryStatus,
    runningBalance: Number(r.running_balance),
  };
}

export function mapCashCategory(r: CashCategoryRow): CashCategory {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    direction: r.direction as CashCategory["direction"],
    isSystem: r.is_system,
    sortOrder: r.sort_order,
  };
}

export interface CashEntriesPage {
  entries: CashEntry[];
  hasMore: boolean;
}

/**
 * The ledger is unbounded and time-sensitive, so it is paginated and never
 * cached in the Zustand store — the same rule bills and logs follow.
 *
 * `on_date` is a plain `date`, so it filters directly. Do NOT wrap the bounds
 * in dayStartISO/dayEndISO: that turns a date into a timestamp and matches
 * nothing.
 */
export async function fetchCashEntriesPage(
  offset: number,
  limit: number,
  filters: CashEntryFilters = {},
): Promise<CashEntriesPage> {
  const supabase = createClient();
  let query = supabase
    .from("cash_entry_v")
    .select("*")
    .order("on_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.from) query = query.gte("on_date", filters.from);
  if (filters.to) query = query.lte("on_date", filters.to);
  if (filters.account) query = query.eq("account", filters.account);
  if (filters.direction) query = query.eq("direction", filters.direction);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.paymentMode) query = query.eq("payment_mode", filters.paymentMode);
  if (filters.sourceType) query = query.eq("source_type", filters.sourceType);

  const q = filters.q ? orSafe(filters.q) : "";
  if (q) {
    query = query.or(
      `note.ilike.*${q}*,reference_no.ilike.*${q}*,source_ref.ilike.*${q}*,category_path.ilike.*${q}*`,
    );
  }

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CashEntryRow[];
  return { entries: rows.map(mapCashEntry), hasMore: rows.length === limit };
}

/** Bounded and slow-changing, so it is fetched once per page mount. */
export async function fetchCashCategories(): Promise<CashCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cash_category_v")
    .select("id, parent_id, name, direction, is_system, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as CashCategoryRow[]).map(mapCashCategory);
}

/**
 * The client passes its own local dates: `current_date` inside a view would be
 * the server's UTC date, which is the wrong day for part of every morning.
 *
 * The range scopes the `period*` figures only — the balances are live, so the
 * tiles keep telling the truth about the drawer while the list below them is
 * filtered.
 */
export async function fetchCashbookSummary(
  range: { from: string | null; to: string | null } = { from: null, to: null },
): Promise<CashbookSummary> {
  const r = await rpc<Record<string, string | number>>("cashbook_summary", {
    p_from: range.from,
    p_to: range.to,
  });
  return {
    cashBalance: Number(r.cashBalance),
    bankBalance: Number(r.bankBalance),
    periodSales: Number(r.periodSales),
    periodExpenses: Number(r.periodExpenses),
    periodCashIn: Number(r.periodCashIn),
    periodCashOut: Number(r.periodCashOut),
  };
}

export interface CashEntryInput {
  onDate: string;
  direction: CashDirection;
  amount: number;
  mode: CashPaymentMode;
  categoryId: string;
  note: string;
  referenceNo: string;
}

export async function rpcAddCashEntry(p: CashEntryInput): Promise<string> {
  return rpc<string>("add_cash_entry", {
    p_on_date: p.onDate,
    p_direction: p.direction,
    p_amount: p.amount,
    p_mode: p.mode,
    p_category_id: p.categoryId,
    p_note: p.note,
    p_reference_no: p.referenceNo,
  });
}

/** `direction` is not editable — delete and re-record to change which way it went. */
export async function rpcUpdateCashEntry(
  id: string,
  p: Omit<CashEntryInput, "direction">,
): Promise<void> {
  await rpc<void>("update_cash_entry", {
    p_id: id,
    p_on_date: p.onDate,
    p_amount: p.amount,
    p_mode: p.mode,
    p_category_id: p.categoryId,
    p_note: p.note,
    p_reference_no: p.referenceNo,
  });
}

export async function rpcDeleteCashEntry(id: string): Promise<void> {
  await rpc<void>("delete_cash_entry", { p_id: id });
}

export async function rpcTransferCash(p: {
  onDate: string;
  fromAccount: CashAccount;
  amount: number;
  note: string;
}): Promise<string> {
  return rpc<string>("transfer_cash", {
    p_on_date: p.onDate,
    p_from_account: p.fromAccount,
    p_amount: p.amount,
    p_note: p.note,
  });
}

export interface CashDayRow {
  on_date: string;
  opening_cash: string | number;
  expected_cash: string | number;
  counted_cash: string | number;
  difference: string | number;
  remarks: string | null;
  status: string;
  closed_by_name: string | null;
  closed_at: string | null;
  reopened_by_name: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
}

export function mapCashDay(r: CashDayRow): CashDay {
  return {
    onDate: r.on_date,
    openingCash: Number(r.opening_cash),
    expectedCash: Number(r.expected_cash),
    countedCash: Number(r.counted_cash),
    difference: Number(r.difference),
    remarks: r.remarks ?? "",
    status: r.status as CashDayStatus,
    closedByName: r.closed_by_name ?? "",
    closedAt: r.closed_at,
    reopenedByName: r.reopened_by_name ?? "",
    reopenedAt: r.reopened_at,
    reopenReason: r.reopen_reason ?? "",
  };
}

export interface CashDayFilters {
  from?: string;
  to?: string;
  /** Only days whose count didn't match. Backs the discrepancy view. */
  varianceOnly?: boolean;
}

export interface CashDaysPage {
  days: CashDay[];
  hasMore: boolean;
}

export async function fetchCashDaysPage(
  offset: number,
  limit: number,
  filters: CashDayFilters = {},
): Promise<CashDaysPage> {
  const supabase = createClient();
  let query = supabase
    .from("cash_day_v")
    .select("*")
    .order("on_date", { ascending: false });
  // `on_date` is a plain date, so it filters directly — no UTC conversion.
  if (filters.from) query = query.gte("on_date", filters.from);
  if (filters.to) query = query.lte("on_date", filters.to);
  if (filters.varianceOnly) query = query.neq("difference", 0);

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CashDayRow[];
  return { days: rows.map(mapCashDay), hasMore: rows.length === limit };
}

/** Null when the day has never been closed — i.e. it is open. */
export async function fetchCashDay(onDate: string): Promise<CashDay | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cash_day_v")
    .select("*")
    .eq("on_date", onDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCashDay(data as CashDayRow) : null;
}

export async function rpcCloseCashDay(
  onDate: string,
  countedCash: number,
  remarks: string,
): Promise<void> {
  await rpc<void>("close_cash_day", {
    p_date: onDate,
    p_counted_cash: countedCash,
    p_remarks: remarks,
  });
}

export async function rpcReopenCashDay(onDate: string, reason: string): Promise<void> {
  await rpc<void>("reopen_cash_day", { p_date: onDate, p_reason: reason });
}

export interface CashDaySummaryRow {
  onDate: string;
  openingCash: string | number;
  expectedCash: string | number;
  cashIn: string | number;
  cashOut: string | number;
  countedCash: string | number | null;
  status: string;
}

/** The reconciliation figures for one day. Backs the day-close page. */
export async function fetchCashDaySummary(onDate: string): Promise<CashDaySummary> {
  const r = await rpc<CashDaySummaryRow>("cash_day_summary", { p_on_date: onDate });
  return {
    onDate: r.onDate,
    openingCash: Number(r.openingCash),
    expectedCash: Number(r.expectedCash),
    cashIn: Number(r.cashIn),
    cashOut: Number(r.cashOut),
    // Null means the day has never been counted, which is different from 0.
    countedCash: r.countedCash === null ? null : Number(r.countedCash),
    status: r.status as CashDayStatus,
  };
}
