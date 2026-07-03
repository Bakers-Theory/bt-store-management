import { describe, it, expect, beforeEach } from "vitest";
import { useBakeryStore } from "./store";
import { DEFAULT_BAKERY, makeOwner } from "./constants";
import type { BillLine, Item } from "./types";

function reset() {
  localStorage.clear();
  useBakeryStore.setState({
    bakery: { ...DEFAULT_BAKERY },
    items: [],
    bills: [],
    logs: [],
    nextBillNo: 1001,
    users: [makeOwner()],
    sessionUserId: null,
  });
}

const s = () => useBakeryStore.getState();
const itemInput = (over: Partial<Item> = {}) => ({
  name: "Bread", emoji: "🍞", category: "Breads", unit: "pcs",
  price: 40, costPrice: 20, qty: 10, ...over,
});

beforeEach(reset);

describe("saveItem", () => {
  it("adds a new item and logs initial stock", () => {
    const r = s().saveItem(itemInput());
    expect(r).toEqual({ kind: "added" });
    expect(s().items).toHaveLength(1);
    expect(s().logs.filter((l) => l.type === "in")).toHaveLength(1);
  });

  it("merges into an existing item by case-insensitive name instead of duplicating", () => {
    s().saveItem(itemInput({ qty: 5 }));
    const r = s().saveItem(itemInput({ name: "bread", qty: 3 }));
    expect(r).toEqual({ kind: "merged", name: "Bread", qty: 3, unit: "pcs" });
    expect(s().items).toHaveLength(1);
    expect(s().items[0].qty).toBe(8);
  });

  it("updates an item and logs a manual adjustment when qty changes", () => {
    s().saveItem(itemInput({ qty: 10 }));
    const id = s().items[0].id;
    const r = s().saveItem(itemInput({ qty: 4 }), id);
    expect(r).toEqual({ kind: "updated" });
    expect(s().items[0].qty).toBe(4);
    const adj = s().logs.find((l) => l.notes === "Manual adjustment");
    expect(adj?.type).toBe("out");
    expect(adj?.qty).toBe(6);
  });
});

describe("stockIn / stockOut", () => {
  it("adds stock with 3-decimal rounding", () => {
    s().saveItem(itemInput({ qty: 10 }));
    const id = s().items[0].id;
    const r = s().stockIn(id, 0.1, "Acme", "");
    expect(r.ok).toBe(true);
    expect(s().items[0].qty).toBe(10.1);
  });

  it("rejects stock-out beyond available quantity", () => {
    s().saveItem(itemInput({ qty: 5 }));
    const id = s().items[0].id;
    const r = s().stockOut(id, 8, "Sold", "");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Only 5");
    expect(s().items[0].qty).toBe(5);
  });

  it("rejects a non-positive quantity", () => {
    s().saveItem(itemInput());
    const id = s().items[0].id;
    expect(s().stockIn(id, 0, "", "").ok).toBe(false);
  });
});

describe("generateBill", () => {
  const lines = (id: string): BillLine[] => [
    { itemId: id, name: "Bread", emoji: "🍞", unit: "pcs", qty: 2, price: 40, costPrice: 20 },
  ];

  it("deducts stock, records totals, bumps bill number, and logs", () => {
    s().saveItem(itemInput({ qty: 10 }));
    const id = s().items[0].id;
    const bill = s().generateBill({ name: "Sam", phone: "9" }, lines(id));
    expect(bill.billNo).toBe(1001);
    expect(bill.subtotal).toBe(80);
    expect(bill.total).toBe(80);
    expect(s().items[0].qty).toBe(8);
    expect(s().nextBillNo).toBe(1002);
    expect(s().logs.some((l) => l.type === "bill")).toBe(true);
  });

  it("never lets stock go negative", () => {
    s().saveItem(itemInput({ qty: 1 }));
    const id = s().items[0].id;
    s().generateBill({ name: "", phone: "" }, lines(id));
    expect(s().items[0].qty).toBe(0);
  });
});

describe("cancelBill / deleteBill", () => {
  function seedBill() {
    s().saveItem(itemInput({ qty: 10 }));
    const id = s().items[0].id;
    const bill = s().generateBill({ name: "", phone: "" }, [
      { itemId: id, name: "Bread", emoji: "🍞", unit: "pcs", qty: 3, price: 40, costPrice: 20 },
    ]);
    return { id, bill };
  }

  it("cancel restocks and marks the bill cancelled", () => {
    const { bill } = seedBill();
    expect(s().items[0].qty).toBe(7);
    const r = s().cancelBill(bill.id, "Owner");
    expect(r.ok).toBe(true);
    expect(s().items[0].qty).toBe(10);
    expect(s().bills[0].status).toBe("cancelled");
    expect(s().bills[0].cancelledBy).toBe("Owner");
  });

  it("cancelling twice is rejected", () => {
    const { bill } = seedBill();
    s().cancelBill(bill.id, "Owner");
    expect(s().cancelBill(bill.id, "Owner").ok).toBe(false);
  });

  it("delete restocks an active bill then removes it", () => {
    const { bill } = seedBill();
    const r = s().deleteBill(bill.id, "Owner");
    expect(r.ok).toBe(true);
    expect(s().items[0].qty).toBe(10);
    expect(s().bills).toHaveLength(0);
  });

  it("delete does NOT double-restock an already-cancelled bill", () => {
    const { bill } = seedBill();
    s().cancelBill(bill.id, "Owner"); // qty back to 10
    s().deleteBill(bill.id, "Owner");
    expect(s().items[0].qty).toBe(10);
    expect(s().bills).toHaveLength(0);
  });
});

describe("users", () => {
  const input = (over = {}) => ({
    name: "Ram", userId: "ram", password: "pass",
    permissions: { sales: true, inventory: false, analytics: false }, ...over,
  });

  it("adds a staff user", () => {
    expect(s().addUser(input()).ok).toBe(true);
    expect(s().users).toHaveLength(2);
  });

  it("rejects a duplicate userId", () => {
    s().addUser(input());
    expect(s().addUser(input()).error).toContain("already taken");
  });

  it("cannot delete the owner", () => {
    const owner = s().users[0];
    expect(s().deleteUser(owner.id).ok).toBe(false);
  });

  it("logs out when the current user deletes themselves", () => {
    s().addUser(input());
    const u = s().users.find((x) => x.userId === "ram")!;
    useBakeryStore.setState({ sessionUserId: u.id });
    const r = s().deleteUser(u.id);
    expect(r.wasCurrentUser).toBe(true);
    expect(s().sessionUserId).toBeNull();
  });

  it("changeOwnPassword enforces a minimum length", () => {
    useBakeryStore.setState({ sessionUserId: "owner" });
    expect(s().changeOwnPassword("ab").ok).toBe(false);
    expect(s().changeOwnPassword("abcd").ok).toBe(true);
    expect(s().users.find((u) => u.id === "owner")!.password).toBe("abcd");
  });
});

describe("login / seedOwner / clearAllData", () => {
  it("logs in with valid credentials", () => {
    const r = s().login("7873557430", "Dominar@400");
    expect(r.ok).toBe(true);
    expect(s().sessionUserId).toBe("owner");
  });
  it("rejects bad credentials", () => {
    expect(s().login("x", "y").ok).toBe(false);
  });
  it("seedOwner is idempotent", () => {
    s().seedOwner();
    s().seedOwner();
    expect(s().users.filter((u) => u.role === "Owner")).toHaveLength(1);
  });
  it("clearAllData wipes items/bills/logs and resets bill number", () => {
    s().saveItem(itemInput());
    s().clearAllData();
    expect(s().items).toHaveLength(0);
    expect(s().nextBillNo).toBe(1001);
    expect(s().users).toHaveLength(1); // users preserved
  });
});
