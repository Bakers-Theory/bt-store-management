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
}

export interface Item {
  id: string;
  name: string;
  emoji: string;
  category: string;
  unit: string;
  price: number; // selling price
  costPrice: number; // bought price (private)
  qty: number;
}

export interface BillLine {
  itemId: string;
  name: string;
  emoji: string;
  unit: string;
  qty: number;
  price: number;
  costPrice: number;
}

export type BillStatus = "active" | "cancelled";

export interface Bill {
  id: string;
  billNo: number;
  customerName: string;
  customerPhone: string;
  items: BillLine[];
  subtotal: number;
  tax: number;
  total: number;
  taxRate: number;
  date: string; // ISO
  status: BillStatus;
  cancelledAt?: string;
  cancelledBy?: string;
}

export type LogType = "in" | "out" | "bill" | "cancel" | "delete";

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
}

export type UserRole = "Owner" | "Staff";

export interface User {
  id: string;
  name: string;
  userId: string;
  role: UserRole;
  permissions: Permissions;
}
