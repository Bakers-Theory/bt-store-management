/**
 * The granular permission catalogue. Mirrored by `has_perm()` in SQL — the SQL
 * copy is the actual enforcement; this one only decides what the UI renders.
 *
 * Clearing all data and the admin audit trail are deliberately absent: they are
 * Owner-only and never grantable, so they have no key to hand out.
 */
export type PermissionKey =
  // Dashboard
  | "dashboard.view"
  | "dashboard.profit"
  // Billing
  | "bill.create"
  | "bill.discount"
  | "bill.print"
  | "bill.cancel"
  | "bill.delete"
  | "bill.history"
  // Inventory
  | "stock.view"
  | "stock.in"
  | "stock.out"
  | "stock.expiry"
  | "items.create"
  | "items.edit"
  | "items.delete"
  | "items.cost"
  // Customers
  | "customers.view"
  | "customers.edit"
  // Reports
  | "reports.view"
  | "reports.export"
  // Store admin
  | "store.settings"
  | "store.status"
  | "store.lists"
  | "staff.manage"
  | "activity.view";

export interface Bakery {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  gst: string;
  logo: string | null; // base64 data URL
  currency: string;
  taxRate: number;
  lowStockAlert: number;
  expiringSoonDays: number;
  isOpen: boolean;
  statusChangedAt: string | null; // ISO, null until the first toggle
  statusChangedBy: string; // name of the user who last changed status ("" if never)
}

export interface Item {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string | null; // uploaded product image URL; null = use emoji
  category: string;
  unit: string;
  price: number; // selling price
  costPrice: number; // bought price (private)
  qty: number;
  tracksExpiry: boolean;
  earliestExpiry: string | null; // "YYYY-MM-DD" of soonest in-stock batch, or null
  // In-stock batches (qty > 0), soonest-expiry-first. Includes expired batches;
  // the bill page filters those out locally to sell/show only fresh stock.
  batches: { qty: number; expiryDate: string | null }[];
}

export interface Batch {
  id: string;
  itemId: string;
  qty: number;
  expiryDate: string | null; // "YYYY-MM-DD" or null (never expires)
  createdAt: string; // ISO
}

export interface BillLine {
  itemId: string;
  name: string;
  emoji: string;
  imageUrl: string | null; // snapshot of the item's image at bill time
  unit: string;
  qty: number;
  price: number;
  costPrice: number;
}

export type BillStatus = "active" | "cancelled";

export type PaymentMethod = "Cash" | "UPI";

export interface Customer {
  id: string;
  phone: string;
  name: string;
  firstSeen: string; // ISO
  visitCount: number;
  totalSpend: number;
  lastPurchase: string | null; // ISO or null if no active bills
}

export interface Bill {
  id: string;
  billNo: number;
  customerId?: string; // FK to customers.id (null for legacy pre-feature bills)
  customerName: string;
  customerPhone: string;
  items: BillLine[];
  subtotal: number;
  tax: number;
  total: number;
  taxRate: number;
  paymentMethod: PaymentMethod;
  discountPercent: number;
  discountType: "percent" | "flat";
  discountAmount: number; // actual money discounted (₹), for percent and flat alike
  billerName: string; // name of the user who generated the bill ("" for legacy bills)
  date: string; // ISO
  status: BillStatus;
  cancelledAt?: string;
  cancelledBy?: string;
}

export type LogType =
  | "in"
  | "out"
  | "bill"
  | "cancel"
  | "delete"
  | "open"
  | "close"
  | "settings"
  | "staff_add"
  | "staff_edit"
  | "staff_remove"
  | "password";

export interface Log {
  id: string;
  type: LogType;
  date: string; // ISO
  // stock movements
  itemId?: string;
  itemName?: string;
  qty?: number;
  supplier?: string;
  reason?: string;
  notes?: string;
  // bill events
  billNo?: number;
  items?: string; // comma-joined item names
  total?: number;
  // who performed the operation
  user?: string;
}

/**
 * The stored role stays a two-value flag: `Owner` is unique (partial unique
 * index) and implicitly holds every permission; everyone else is `Staff`.
 *
 * Admin / Manager / Cashier / Storekeeper are **presets, not stored roles** —
 * choosing one stamps its permission set into `User.permissions`, which is the
 * only thing ever enforced. The badge a staff member displays is *derived* from
 * their set (`presetForPerms`), so a stored label can never disagree with what
 * they can actually do.
 */
export type UserRole = "Owner" | "Staff";

export type PresetRole = "Admin" | "Manager" | "Cashier" | "Storekeeper";

/** What the UI shows as someone's role. Derived, never stored. */
export type RoleLabel = "Owner" | PresetRole | "Custom" | "No access";

export interface User {
  id: string;
  name: string;
  userId: string;
  role: UserRole;
  /** Granular grants. Empty for the Owner, who bypasses the check entirely. */
  permissions: PermissionKey[];
}

export interface StoreLists {
  categories: string[];
  emojis: string[];
  units: string[];
  reasons: string[];
}
