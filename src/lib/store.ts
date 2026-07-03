"use client";

import { create } from "zustand";
import type { Bakery, Bill, BillLine, Item, Log, Permissions } from "./types";
import {
  fetchStoreData,
  rpcCancelBill,
  rpcClearAllData,
  rpcCreateItem,
  rpcDeleteBill,
  rpcDeleteItem,
  rpcGenerateBill,
  rpcSaveSettings,
  rpcStockIn,
  rpcStockOut,
  rpcUpdateItem,
} from "./supabase-data";

// ─── Action result types (unchanged contract) ─────────────────────────────
export type SaveItemResult =
  | { kind: "added" }
  | { kind: "updated" }
  | { kind: "merged"; name: string; qty: number; unit: string };

export interface StockResult {
  ok: boolean;
  error?: string;
  name?: string;
  unit?: string;
  qty?: number;
}

export interface Result {
  ok: boolean;
  error?: string;
}

export interface ItemInput {
  name: string;
  emoji: string;
  category: string;
  unit: string;
  price: number;
  costPrice: number;
  qty: number;
}

export interface SettingsInput {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  gst: string;
  currency: string;
  taxRate: number;
  lowStockAlert: number;
}

interface StoreState {
  bakery: Bakery;
  items: Item[];
  bills: Bill[];
  logs: Log[];
  _hasHydrated: boolean;

  /** Load all data from Supabase into the client cache. */
  load: () => Promise<void>;

  saveItem: (input: ItemInput, id?: string) => Promise<SaveItemResult>;
  deleteItem: (id: string) => Promise<void>;
  stockIn: (itemId: string, qty: number, supplier: string, notes: string) => Promise<StockResult>;
  stockOut: (itemId: string, qty: number, reason: string, notes: string) => Promise<StockResult>;

  generateBill: (
    customer: { name: string; phone: string },
    lines: BillLine[],
  ) => Promise<Bill>;
  cancelBill: (id: string, byName: string) => Promise<Result & { billNo?: number }>;
  deleteBill: (id: string, byName: string) => Promise<Result & { billNo?: number }>;

  saveSettings: (input: SettingsInput) => Promise<void>;
  clearAllData: () => Promise<void>;
}

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : "Something went wrong";

// Neutral placeholder for the store's initial state only. The real profile is
// loaded from Supabase (`store_settings`); the app is gated on `_hasHydrated`
// so this is never rendered.
const PLACEHOLDER_BAKERY: Bakery = {
  name: "",
  tagline: "",
  address: "",
  phone: "",
  gst: "",
  currency: "₹",
  taxRate: 0,
  lowStockAlert: 5,
};

export const useBakeryStore = create<StoreState>()((set, get) => ({
  bakery: PLACEHOLDER_BAKERY,
  items: [],
  bills: [],
  logs: [],
  _hasHydrated: false,

  load: async () => {
    try {
      const data = await fetchStoreData();
      set({ ...data, _hasHydrated: true });
    } catch {
      set({ _hasHydrated: true });
    }
  },

  // ─── Items ───────────────────────────────────────────────────────────────
  saveItem: async (input, id) => {
    if (id) {
      await rpcUpdateItem(id, input);
      await get().load();
      return { kind: "updated" };
    }
    const r = await rpcCreateItem(input);
    await get().load();
    if (r.kind === "merged") {
      return { kind: "merged", name: r.name ?? input.name, qty: r.qty ?? input.qty, unit: r.unit ?? input.unit };
    }
    return { kind: "added" };
  },

  deleteItem: async (id) => {
    await rpcDeleteItem(id);
    await get().load();
  },

  stockIn: async (itemId, qty, supplier, notes) => {
    if (!itemId) return { ok: false, error: "Please select an item" };
    if (!qty || qty <= 0) return { ok: false, error: "Enter a valid quantity" };
    const item = get().items.find((i) => i.id === itemId);
    try {
      await rpcStockIn(itemId, qty, supplier, notes);
      await get().load();
      return { ok: true, name: item?.name, unit: item?.unit, qty };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  },

  stockOut: async (itemId, qty, reason, notes) => {
    if (!itemId) return { ok: false, error: "Please select an item" };
    if (!qty || qty <= 0) return { ok: false, error: "Enter a valid quantity" };
    const item = get().items.find((i) => i.id === itemId);
    try {
      await rpcStockOut(itemId, qty, reason, notes);
      await get().load();
      return { ok: true, name: item?.name, unit: item?.unit, qty };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  },

  // ─── Bills ───────────────────────────────────────────────────────────────
  generateBill: async (customer, lines) => {
    const row = await rpcGenerateBill(
      customer,
      lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    );
    const bill: Bill = {
      id: row.id,
      billNo: row.bill_no,
      customerName: customer.name,
      customerPhone: customer.phone,
      items: lines.map((l) => ({ ...l })),
      subtotal: row.subtotal,
      tax: row.tax,
      total: row.total,
      taxRate: row.tax_rate,
      date: row.created_at,
      status: "active",
    };
    await get().load();
    return bill;
  },

  cancelBill: async (id, byName) => {
    const bill = get().bills.find((b) => b.id === id);
    try {
      await rpcCancelBill(id, byName);
      await get().load();
      return { ok: true, billNo: bill?.billNo };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  },

  deleteBill: async (id, byName) => {
    const bill = get().bills.find((b) => b.id === id);
    try {
      await rpcDeleteBill(id, byName);
      await get().load();
      return { ok: true, billNo: bill?.billNo };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  saveSettings: async (input) => {
    await rpcSaveSettings(input);
    await get().load();
  },

  clearAllData: async () => {
    await rpcClearAllData();
    await get().load();
  },
}));

export type { Permissions };
