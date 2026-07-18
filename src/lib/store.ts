"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type { Bakery, Bill, BillLine, Item, PaymentMethod, Permissions, StoreLists } from "./types";
import {
  fetchBaseData,
  fetchItems,
  fetchLists,
  fetchSettings,
  rpcAddListValue,
  rpcCancelBill,
  rpcClearAllData,
  rpcCreateItem,
  rpcDeleteBill,
  rpcDeleteItem,
  rpcDeleteListValue,
  rpcGenerateBill,
  rpcSaveSettings,
  rpcSetItemImage,
  rpcSetStoreStatus,
  rpcStockIn,
  rpcStockOut,
  rpcUpdateBatchExpiry,
  rpcUpdateItem,
  rpcUpdateLogo,
  rpcWriteOffBatch,
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
  imageUrl: string | null;
  category: string;
  unit: string;
  price: number;
  costPrice: number;
  qty: number;
  tracksExpiry: boolean;
  expiryDate: string | null;
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
  expiringSoonDays: number;
}

interface StoreState {
  bakery: Bakery;
  items: Item[];
  lists: StoreLists;
  _hasHydrated: boolean;

  /**
   * Load the bounded base data (store settings + item catalogue) into the
   * client cache. Bills / logs are intentionally not cached here — the
   * dashboard reads server-side aggregates and History paginates — so this
   * stays cheap enough to re-run after every mutation.
   */
  load: () => Promise<void>;

  /** Clear all cached base data (in-memory + persisted). Called on sign-out so a
   *  different user on the same device never sees the previous store's data. */
  reset: () => void;

  saveItem: (input: ItemInput, id?: string) => Promise<SaveItemResult>;
  /** Persist only an existing item's image (null clears it); patches the cache. */
  setItemImage: (id: string, url: string | null) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  stockIn: (itemId: string, qty: number, supplier: string, notes: string, expiry: string | null) => Promise<StockResult>;
  stockOut: (itemId: string, qty: number, reason: string, notes: string) => Promise<StockResult>;
  writeOffBatch: (batchId: string) => Promise<Result>;
  updateBatchExpiry: (batchId: string, expiry: string) => Promise<Result>;

  generateBill: (
    customer: { name: string; phone: string },
    lines: BillLine[],
    paymentMethod: PaymentMethod,
    discountPercent: number,
    billerName: string,
  ) => Promise<Bill>;
  cancelBill: (id: string, byName: string) => Promise<Result>;
  deleteBill: (id: string, byName: string) => Promise<Result>;

  saveSettings: (input: SettingsInput) => Promise<void>;
  setStoreStatus: (open: boolean, byName: string) => Promise<void>;
  refreshSettings: () => Promise<void>;
  uploadLogo: (dataUrl: string) => Promise<void>;
  removeLogo: () => Promise<void>;
  clearAllData: () => Promise<void>;

  addListValue: (kind: string, value: string) => Promise<Result>;
  deleteListValue: (id: string) => Promise<Result>;
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
  logo: null,
  currency: "₹",
  taxRate: 0,
  lowStockAlert: 5,
  expiringSoonDays: 3,
  isOpen: true,
  statusChangedAt: null,
  statusChangedBy: "",
};

const EMPTY_LISTS: StoreLists = { categories: [], emojis: [], units: [], reasons: [] };

// SSR-safe storage: this module is a client component but Next still executes it
// on the server, where `localStorage` doesn't exist. Fall back to a no-op there.
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useBakeryStore = create<StoreState>()(
  persist(
    (set, get) => {
  // Patch one item in place (by id), appending it if it's not cached yet.
  // Used by item-scoped RPCs that now return the updated items_v row, so a
  // single stock/price change no longer re-downloads the whole catalogue.
  const patchItem = (item: Item) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === item.id);
      if (idx === -1) return { items: [...s.items, item] };
      const items = [...s.items];
      items[idx] = item;
      return { items };
    });

  // Re-fetch only the bounded resource a mutation actually touched, instead
  // of the full base-data reload every action used to trigger. Best-effort —
  // on failure the previous cached value is kept rather than clobbered.
  const refreshItems = async () => {
    try {
      set({ items: await fetchItems() });
    } catch {
      /* keep previous items */
    }
  };
  const refreshSettings = async () => {
    try {
      set({ bakery: await fetchSettings() });
    } catch {
      /* keep previous settings */
    }
  };
  const refreshLists = async () => {
    try {
      set({ lists: await fetchLists() });
    } catch {
      /* keep previous lists */
    }
  };

  return {
    bakery: PLACEHOLDER_BAKERY,
    items: [],
    lists: EMPTY_LISTS,
    _hasHydrated: false,

    load: async () => {
      // persist rehydrates synchronously from localStorage before this runs, so
      // if we already have cached base data, paint the real UI immediately and
      // refresh in the background (stale-while-revalidate).
      if (get().items.length > 0 || get().bakery.name !== "") {
        set({ _hasHydrated: true });
      }
      try {
        const data = await fetchBaseData();
        set({ ...data, _hasHydrated: true });
      } catch {
        set({ _hasHydrated: true });
      }
    },

    reset: () =>
      set({ bakery: PLACEHOLDER_BAKERY, items: [], lists: EMPTY_LISTS, _hasHydrated: false }),

    // ─── Items ─────────────────────────────────────────────────────────────
    saveItem: async (input, id) => {
      if (id) {
        patchItem(await rpcUpdateItem(id, input));
        return { kind: "updated" };
      }
      const r = await rpcCreateItem(input);
      if (r.item) patchItem(r.item);
      if (r.kind === "merged") {
        return { kind: "merged", name: r.name ?? input.name, qty: r.qty ?? input.qty, unit: r.unit ?? input.unit };
      }
      return { kind: "added" };
    },

    setItemImage: async (id, url) => {
      patchItem(await rpcSetItemImage(id, url));
    },

    deleteItem: async (id) => {
      await rpcDeleteItem(id);
      set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
    },

    stockIn: async (itemId, qty, supplier, notes, expiry) => {
      if (!itemId) return { ok: false, error: "Please select an item" };
      if (!qty || qty <= 0) return { ok: false, error: "Enter a valid quantity" };
      const item = get().items.find((i) => i.id === itemId);
      try {
        const updated = await rpcStockIn(itemId, qty, supplier, notes, expiry);
        patchItem(updated);
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
        const updated = await rpcStockOut(itemId, qty, reason, notes);
        patchItem(updated);
        return { ok: true, name: item?.name, unit: item?.unit, qty };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },

    writeOffBatch: async (batchId) => {
      try {
        patchItem(await rpcWriteOffBatch(batchId));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },

    updateBatchExpiry: async (batchId, expiry) => {
      try {
        patchItem(await rpcUpdateBatchExpiry(batchId, expiry));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },

    // ─── Bills ─────────────────────────────────────────────────────────────
    // A bill can consume stock across many items at once (FIFO, per line), so
    // it refreshes the item list rather than patching a single row — still far
    // cheaper than the old full reload, since settings/lists never change here.
    generateBill: async (customer, lines, paymentMethod, discountPercent, billerName) => {
      const row = await rpcGenerateBill(
        { ...customer, payment: paymentMethod, discount: discountPercent },
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
        paymentMethod,
        discountPercent,
        billerName,
        date: row.created_at,
        status: "active",
      };
      await refreshItems();
      return bill;
    },

    cancelBill: async (id, byName) => {
      try {
        await rpcCancelBill(id, byName);
        await refreshItems();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },

    deleteBill: async (id, byName) => {
      try {
        await rpcDeleteBill(id, byName);
        await refreshItems();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },

    // ─── Settings ────────────────────────────────────────────────────────────
    saveSettings: async (input) => {
      await rpcSaveSettings(input);
      await refreshSettings();
    },

    setStoreStatus: async (open, byName) => {
      await rpcSetStoreStatus(open, byName);
      await refreshSettings();
    },

    refreshSettings,

    uploadLogo: async (dataUrl) => {
      await rpcUpdateLogo(dataUrl);
      await refreshSettings();
    },

    removeLogo: async () => {
      await rpcUpdateLogo(null);
      await refreshSettings();
    },

    // Wipes bills/items/batches/log but leaves settings and lists untouched.
    clearAllData: async () => {
      await rpcClearAllData();
      await refreshItems();
    },

    addListValue: async (kind, value) => {
      try {
        await rpcAddListValue(kind, value);
        await refreshLists();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },

    deleteListValue: async (id) => {
      try {
        await rpcDeleteListValue(id);
        await refreshLists();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },
    };
    },
    {
      name: "bt-base-data",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      // Only the bounded, slow-changing base data is cached — never actions,
      // the hydration flag, or unbounded/time-sensitive data (bills, dashboard).
      partialize: (s) => ({ bakery: s.bakery, items: s.items, lists: s.lists }),
    },
  ),
);

export type { Permissions };
