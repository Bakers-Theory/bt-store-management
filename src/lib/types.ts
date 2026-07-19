export type PermissionKey = "sales" | "inventory" | "analytics";

export interface Permissions {
  sales: boolean;
  inventory: boolean;
  analytics: boolean;
}

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

export type UserRole = "Owner" | "Staff";

export interface User {
  id: string;
  name: string;
  userId: string;
  role: UserRole;
  permissions: Permissions;
}

export interface StoreLists {
  categories: string[];
  emojis: string[];
  units: string[];
  reasons: string[];
}
