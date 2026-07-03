"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Bakery,
  BakeryState,
  Bill,
  BillLine,
  Item,
  Permissions,
  User,
} from "./types";
import { DEFAULT_BAKERY, makeOwner } from "./constants";
import { computeTotals } from "./bill";
import { buildDemoData, DEMO_BAKERY, DEMO_STAFF } from "./demo";
import { round3, uid } from "./format";

// ─── Action result types ──────────────────────────────────────────────
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

export interface UserInput {
  name: string;
  userId: string;
  password: string;
  permissions: Permissions;
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

interface Actions {
  setHasHydrated: () => void;
  seedOwner: () => void;
  seedDemo: () => void;
  clearDemo: () => void;
  login: (userId: string, password: string) => Result & { user?: User };
  logout: () => void;

  saveItem: (input: ItemInput, id?: string) => SaveItemResult;
  deleteItem: (id: string) => void;
  stockIn: (itemId: string, qty: number, supplier: string, notes: string) => StockResult;
  stockOut: (itemId: string, qty: number, reason: string, notes: string) => StockResult;

  generateBill: (
    customer: { name: string; phone: string },
    lines: BillLine[],
  ) => Bill;
  cancelBill: (id: string, byName: string) => Result & { billNo?: number };
  deleteBill: (id: string, byName: string) => Result & { billNo?: number };

  addUser: (input: UserInput) => Result;
  editUser: (id: string, input: UserInput) => Result;
  deleteUser: (id: string) => { ok: boolean; wasCurrentUser: boolean };
  changeOwnPassword: (password: string) => Result;

  saveSettings: (input: SettingsInput) => void;
  uploadLogo: (dataUrl: string) => void;
  removeLogo: () => void;
  clearAllData: () => void;
}

interface StoreState extends BakeryState, Actions {
  _hasHydrated: boolean;
}

const initialData: BakeryState = {
  bakery: { ...DEFAULT_BAKERY },
  items: [],
  bills: [],
  logs: [],
  nextBillNo: 1001,
  users: [makeOwner()],
  sessionUserId: null,
};

/** Immutably replace the item with `id`, applying `fn` to a copy. */
function patchItem(items: Item[], id: string, fn: (i: Item) => Item): Item[] {
  return items.map((i) => (i.id === id ? fn({ ...i }) : i));
}

export const useBakeryStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...initialData,
      _hasHydrated: false,

      setHasHydrated: () => set({ _hasHydrated: true }),

      seedOwner: () => {
        const { users } = get();
        if (!users.some((u) => u.role === "Owner")) {
          set({ users: [makeOwner(), ...users] });
        }
      },

      // Populate demo data (test/demo builds only). No-op if any real data
      // already exists, so it never clobbers a user's store.
      seedDemo: () => {
        const state = get();
        if (state.items.length > 0 || state.bills.length > 0) return;
        const { items, bills, logs, nextBillNo } = buildDemoData(new Date());
        const isDefaultBakery = state.bakery.name === DEFAULT_BAKERY.name;
        set({
          items,
          bills,
          logs,
          nextBillNo,
          bakery: isDefaultBakery ? { ...state.bakery, ...DEMO_BAKERY } : state.bakery,
          users: state.users.some((u) => u.userId === DEMO_STAFF.userId)
            ? state.users
            : [...state.users, DEMO_STAFF],
        });
      },

      // Strip previously-seeded demo data (all `demo-` ids, the demo staff user,
      // and the demo bakery), leaving any real data intact. Runs when the app is
      // not in test mode, so switching to production removes leftover demo data.
      clearDemo: () => {
        const state = get();
        const isDemo = (id: string) => id.startsWith("demo-");
        const hadDemoBills = state.bills.some((b) => isDemo(b.id));
        const hadDemoData =
          hadDemoBills ||
          state.items.some((i) => isDemo(i.id)) ||
          state.logs.some((l) => isDemo(l.id)) ||
          state.users.some((u) => u.id === DEMO_STAFF.id) ||
          state.bakery.name === DEMO_BAKERY.name;
        if (!hadDemoData) return;

        const bills = state.bills.filter((b) => !isDemo(b.id));
        set({
          items: state.items.filter((i) => !isDemo(i.id)),
          bills,
          logs: state.logs.filter((l) => !isDemo(l.id)),
          users: state.users.filter((u) => u.id !== DEMO_STAFF.id),
          nextBillNo: hadDemoBills
            ? bills.length
              ? Math.max(...bills.map((b) => b.billNo)) + 1
              : 1001
            : state.nextBillNo,
          sessionUserId:
            state.sessionUserId === DEMO_STAFF.id ? null : state.sessionUserId,
          bakery:
            state.bakery.name === DEMO_BAKERY.name ? { ...DEFAULT_BAKERY } : state.bakery,
        });
      },

      login: (userId, password) => {
        if (!userId || !password) {
          return { ok: false, error: "Please enter your User ID and Password." };
        }
        const user = get().users.find(
          (u) => u.userId === userId && u.password === password,
        );
        if (!user) return { ok: false, error: "❌ Invalid User ID or Password" };
        set({ sessionUserId: user.id });
        return { ok: true, user };
      },

      logout: () => set({ sessionUserId: null }),

      // ─── Items ───────────────────────────────────────────────────────
      saveItem: (input, id) => {
        const state = get();
        if (id) {
          const existing = state.items.find((i) => i.id === id);
          const oldQty = existing ? existing.qty : 0;
          const items = patchItem(state.items, id, (i) => ({
            ...i,
            name: input.name,
            emoji: input.emoji,
            category: input.category,
            unit: input.unit,
            price: input.price,
            costPrice: input.costPrice,
            qty: input.qty,
          }));
          const logs = [...state.logs];
          if (input.qty !== oldQty) {
            logs.push({
              id: uid(),
              type: input.qty > oldQty ? "in" : "out",
              itemId: id,
              itemName: input.name,
              qty: Math.abs(input.qty - oldQty),
              notes: "Manual adjustment",
              date: new Date().toISOString(),
            });
          }
          set({ items, logs });
          return { kind: "updated" };
        }

        // Add — merge into an existing (case-insensitive) name instead of duplicating.
        const dup = state.items.find(
          (i) => i.name.trim().toLowerCase() === input.name.toLowerCase(),
        );
        if (dup) {
          const logs = [...state.logs];
          let items = state.items;
          if (input.qty > 0) {
            items = patchItem(state.items, dup.id, (i) => ({
              ...i,
              qty: round3(i.qty + input.qty),
            }));
            logs.push({
              id: uid(),
              type: "in",
              itemId: dup.id,
              itemName: dup.name,
              qty: input.qty,
              notes: "Added via New Item form (existing item)",
              date: new Date().toISOString(),
            });
          }
          set({ items, logs });
          return { kind: "merged", name: dup.name, qty: input.qty, unit: dup.unit };
        }

        const newItem: Item = {
          id: uid(),
          name: input.name,
          emoji: input.emoji,
          category: input.category,
          unit: input.unit,
          price: input.price,
          costPrice: input.costPrice,
          qty: input.qty,
        };
        const logs = [...state.logs];
        if (input.qty > 0) {
          logs.push({
            id: uid(),
            type: "in",
            itemId: newItem.id,
            itemName: input.name,
            qty: input.qty,
            notes: "Initial stock",
            date: new Date().toISOString(),
          });
        }
        set({ items: [...state.items, newItem], logs });
        return { kind: "added" };
      },

      deleteItem: (id) =>
        set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

      stockIn: (itemId, qty, supplier, notes) => {
        if (!itemId) return { ok: false, error: "Please select an item" };
        if (!qty || qty <= 0) return { ok: false, error: "Enter a valid quantity" };
        const state = get();
        const item = state.items.find((i) => i.id === itemId);
        if (!item) return { ok: false, error: "Item not found" };
        const items = patchItem(state.items, itemId, (i) => ({
          ...i,
          qty: round3(i.qty + qty),
        }));
        set({
          items,
          logs: [
            ...state.logs,
            { id: uid(), type: "in", itemId, itemName: item.name, qty, supplier, notes, date: new Date().toISOString() },
          ],
        });
        return { ok: true, name: item.name, unit: item.unit, qty };
      },

      stockOut: (itemId, qty, reason, notes) => {
        if (!itemId) return { ok: false, error: "Please select an item" };
        if (!qty || qty <= 0) return { ok: false, error: "Enter a valid quantity" };
        const state = get();
        const item = state.items.find((i) => i.id === itemId);
        if (!item) return { ok: false, error: "Item not found" };
        if (qty > item.qty)
          return { ok: false, error: `Only ${item.qty} ${item.unit} available` };
        const items = patchItem(state.items, itemId, (i) => ({
          ...i,
          qty: round3(i.qty - qty),
        }));
        set({
          items,
          logs: [
            ...state.logs,
            { id: uid(), type: "out", itemId, itemName: item.name, qty, reason, notes, date: new Date().toISOString() },
          ],
        });
        return { ok: true, name: item.name, unit: item.unit, qty };
      },

      // ─── Bills ───────────────────────────────────────────────────────
      generateBill: (customer, lines) => {
        const state = get();
        const { subtotal, tax, total } = computeTotals(lines, state.bakery.taxRate);
        const now = new Date();
        const billNo = state.nextBillNo;

        let items = state.items;
        lines.forEach((bi) => {
          items = patchItem(items, bi.itemId, (i) => ({
            ...i,
            qty: Math.max(0, round3(i.qty - bi.qty)),
          }));
        });

        const bill: Bill = {
          id: uid(),
          billNo,
          customerName: customer.name,
          customerPhone: customer.phone,
          items: lines.map((l) => ({ ...l })),
          subtotal,
          tax,
          total,
          taxRate: state.bakery.taxRate,
          date: now.toISOString(),
          status: "active",
        };
        set({
          items,
          bills: [...state.bills, bill],
          nextBillNo: billNo + 1,
          logs: [
            ...state.logs,
            { id: uid(), type: "bill", billNo, items: lines.map((b) => b.name).join(", "), total, date: now.toISOString() },
          ],
        });
        return bill;
      },

      cancelBill: (id, byName) => {
        const state = get();
        const bill = state.bills.find((b) => b.id === id);
        if (!bill) return { ok: false };
        if (bill.status === "cancelled") return { ok: false, error: "Already cancelled" };
        let items = state.items;
        bill.items.forEach((bi) => {
          items = patchItem(items, bi.itemId, (i) => ({
            ...i,
            qty: round3(i.qty + bi.qty),
          }));
        });
        const now = new Date().toISOString();
        const bills = state.bills.map((b) =>
          b.id === id
            ? { ...b, status: "cancelled" as const, cancelledAt: now, cancelledBy: byName }
            : b,
        );
        set({
          items,
          bills,
          logs: [
            ...state.logs,
            { id: uid(), type: "cancel", billNo: bill.billNo, items: bill.items.map((i) => i.name).join(", "), total: bill.total, notes: `Cancelled by ${byName}`, date: now },
          ],
        });
        return { ok: true, billNo: bill.billNo };
      },

      deleteBill: (id, byName) => {
        const state = get();
        const bill = state.bills.find((b) => b.id === id);
        if (!bill) return { ok: false };
        let items = state.items;
        if (bill.status !== "cancelled") {
          bill.items.forEach((bi) => {
            items = patchItem(items, bi.itemId, (i) => ({
              ...i,
              qty: round3(i.qty + bi.qty),
            }));
          });
        }
        set({
          items,
          bills: state.bills.filter((b) => b.id !== id),
          logs: [
            ...state.logs,
            { id: uid(), type: "delete", billNo: bill.billNo, items: bill.items.map((i) => i.name).join(", "), total: bill.total, notes: `Deleted by ${byName}`, date: new Date().toISOString() },
          ],
        });
        return { ok: true, billNo: bill.billNo };
      },

      // ─── Users ───────────────────────────────────────────────────────
      addUser: (input) => {
        const state = get();
        if (!input.name || !input.userId || !input.password)
          return { ok: false, error: "All fields marked * are required." };
        if (state.users.some((u) => u.userId === input.userId))
          return { ok: false, error: "This User ID is already taken." };
        const user: User = {
          id: uid(),
          name: input.name,
          userId: input.userId,
          password: input.password,
          role: "Staff",
          permissions: input.permissions,
        };
        set({ users: [...state.users, user] });
        return { ok: true };
      },

      editUser: (id, input) => {
        const state = get();
        if (!input.name || !input.userId || !input.password)
          return { ok: false, error: "All fields marked * are required." };
        if (state.users.some((u) => u.userId === input.userId && u.id !== id))
          return { ok: false, error: "This User ID is already taken." };
        set({
          users: state.users.map((u) =>
            u.id === id
              ? { ...u, name: input.name, userId: input.userId, password: input.password, permissions: input.permissions }
              : u,
          ),
        });
        return { ok: true };
      },

      deleteUser: (id) => {
        const state = get();
        const u = state.users.find((x) => x.id === id);
        if (!u || u.role === "Owner") return { ok: false, wasCurrentUser: false };
        const wasCurrentUser = state.sessionUserId === id;
        set({
          users: state.users.filter((x) => x.id !== id),
          sessionUserId: wasCurrentUser ? null : state.sessionUserId,
        });
        return { ok: true, wasCurrentUser };
      },

      changeOwnPassword: (password) => {
        const state = get();
        if (!password || password.length < 4)
          return { ok: false, error: "Password must be at least 4 characters." };
        if (!state.sessionUserId) return { ok: false, error: "Not logged in." };
        set({
          users: state.users.map((u) =>
            u.id === state.sessionUserId ? { ...u, password } : u,
          ),
        });
        return { ok: true };
      },

      // ─── Settings ──────────────────────────────────────────────────────
      saveSettings: (input) =>
        set((s) => ({
          bakery: {
            ...s.bakery,
            name: input.name || "My Bakery",
            tagline: input.tagline,
            address: input.address,
            phone: input.phone,
            gst: input.gst,
            currency: input.currency,
            taxRate: input.taxRate,
            lowStockAlert: input.lowStockAlert,
          } as Bakery,
        })),

      uploadLogo: (dataUrl) =>
        set((s) => ({ bakery: { ...s.bakery, logo: dataUrl } })),

      removeLogo: () => set((s) => ({ bakery: { ...s.bakery, logo: null } })),

      clearAllData: () =>
        set({ items: [], bills: [], logs: [], nextBillNo: 1001 }),
    }),
    {
      name: "bt-store-management",
      // Hydrate explicitly from a mount effect (see StoreHydrator) so the first
      // client render matches the server (both pre-hydration), avoiding a
      // hydration mismatch on this fully client-driven app.
      skipHydration: true,
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : (undefined as unknown as Storage),
      ),
      partialize: (s) => ({
        bakery: s.bakery,
        items: s.items,
        bills: s.bills,
        logs: s.logs,
        nextBillNo: s.nextBillNo,
        users: s.users,
        sessionUserId: s.sessionUserId,
      }),
      // Runs synchronously during create() for localStorage, so it must not
      // reference `useBakeryStore` (not yet assigned — TDZ). Use the store's
      // own actions, which close over `set`/`get`.
      onRehydrateStorage: () => (state) => {
        state?.seedOwner();
        state?.setHasHydrated();
      },
    },
  ),
);

/** The logged-in user derived from the persisted session id. */
export function useCurrentUser(): User | null {
  return useBakeryStore(
    (s) => s.users.find((u) => u.id === s.sessionUserId) ?? null,
  );
}
