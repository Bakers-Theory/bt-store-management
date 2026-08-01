import { describe, it, expect } from "vitest";
import {
  groupLists,
  mapCashCategory,
  mapCashDay,
  mapCashEntry,
  mapCustomer,
  mapBill,
  mapItem,
} from "./supabase-data";

describe("mapCashEntry", () => {
  const row = {
    id: "e1",
    on_date: "2026-07-31",
    created_at: "2026-07-31T04:00:00.000Z",
    account: "cash",
    direction: "out",
    // Postgres numeric arrives as a STRING over the wire.
    amount: "3000.00",
    payment_mode: "Cash",
    category_id: "c1",
    category_name: "Rent",
    category_group: "Utilities",
    category_path: "Utilities › Rent",
    source_type: "manual",
    source_id: null,
    reverses_id: null,
    transfer_id: null,
    reference_no: "",
    note: "July rent",
    created_by: "u1",
    created_by_name: "Ravi",
    status: "posted",
    source_ref: "",
    running_balance: "-3000.00",
  };

  it("coerces the numeric strings Postgres sends into numbers", () => {
    const e = mapCashEntry(row as never);
    expect(e.amount).toBe(3000);
    expect(e.runningBalance).toBe(-3000);
    expect(typeof e.amount).toBe("number");
  });

  it("maps snake_case to camelCase and keeps nulls as null", () => {
    const e = mapCashEntry(row as never);
    expect(e.onDate).toBe("2026-07-31");
    expect(e.categoryPath).toBe("Utilities › Rent");
    expect(e.createdByName).toBe("Ravi");
    expect(e.createdById).toBe("u1");
    expect(e.sourceId).toBeNull();
    expect(e.reversesId).toBeNull();
  });

  it("defaults absent text fields to empty strings rather than undefined", () => {
    const e = mapCashEntry({ ...row, note: null, source_ref: null } as never);
    expect(e.note).toBe("");
    expect(e.sourceRef).toBe("");
  });
});

describe("mapCashCategory", () => {
  it("maps a leaf and its group", () => {
    const c = mapCashCategory({
      id: "c1",
      parent_id: "g1",
      name: "Rent",
      direction: "out",
      is_system: false,
      sort_order: 3,
    } as never);
    expect(c).toEqual({
      id: "c1",
      parentId: "g1",
      name: "Rent",
      direction: "out",
      isSystem: false,
      sortOrder: 3,
    });
  });

  it("keeps a top-level category's null parent", () => {
    const c = mapCashCategory({
      id: "g1",
      parent_id: null,
      name: "Utilities",
      direction: "out",
      is_system: false,
      sort_order: 13,
    } as never);
    expect(c.parentId).toBeNull();
  });
});

describe("mapCashDay", () => {
  const row = {
    on_date: "2026-07-31",
    // Postgres numeric arrives as a STRING over the wire.
    opening_cash: "7200.00",
    expected_cash: "5900.00",
    counted_cash: "5850.00",
    difference: "-50.00",
    remarks: "50 short",
    status: "closed",
    closed_by_name: "Ravi",
    closed_at: "2026-07-31T15:40:00.000Z",
    reopened_by_name: "",
    reopened_at: null,
    reopen_reason: "",
  };

  it("coerces every money column to a number", () => {
    const d = mapCashDay(row as never);
    expect(d.openingCash).toBe(7200);
    expect(d.expectedCash).toBe(5900);
    expect(d.countedCash).toBe(5850);
    expect(d.difference).toBe(-50);
  });

  it("maps snake_case to camelCase and keeps a null timestamp null", () => {
    const d = mapCashDay(row as never);
    expect(d.onDate).toBe("2026-07-31");
    expect(d.status).toBe("closed");
    expect(d.closedByName).toBe("Ravi");
    expect(d.reopenedAt).toBeNull();
  });

  it("reads a reopened day's audit trail", () => {
    const d = mapCashDay({
      ...row,
      status: "open",
      reopened_by_name: "Asha",
      reopened_at: "2026-08-01T04:00:00.000Z",
      reopen_reason: "recount",
    } as never);
    expect(d.status).toBe("open");
    expect(d.reopenedByName).toBe("Asha");
    expect(d.reopenReason).toBe("recount");
    // The close figures survive a reopen — that is what it answers to.
    expect(d.countedCash).toBe(5850);
  });
});

describe("groupLists", () => {
  it("buckets rows by kind and preserves input order", () => {
    expect(
      groupLists([
        { kind: "category", value: "Breads" },
        { kind: "category", value: "Cakes" },
        { kind: "unit", value: "pcs" },
        { kind: "emoji", value: "🥐" },
        { kind: "reason", value: "Sold" },
      ]),
    ).toEqual({
      categories: ["Breads", "Cakes"],
      units: ["pcs"],
      emojis: ["🥐"],
      reasons: ["Sold"],
    });
  });

  it("yields empty arrays for absent kinds", () => {
    expect(groupLists([])).toEqual({
      categories: [], emojis: [], units: [], reasons: [],
    });
  });

  it("ignores unknown kinds", () => {
    expect(groupLists([{ kind: "bogus", value: "x" }])).toEqual({
      categories: [], emojis: [], units: [], reasons: [],
    });
  });
});

describe("mapCustomer", () => {
  it("maps RPC snake_case to Customer, coercing string aggregates", () => {
    // Postgres serialises bigint/numeric aggregates as strings over the wire.
    expect(
      mapCustomer({
        id: "c1",
        phone: "9876543210",
        name: "Asha",
        first_seen: "2026-01-01T00:00:00Z",
        visit_count: "3",
        total_spend: "1250.50",
        last_purchase: "2026-06-30T10:00:00Z",
      }),
    ).toEqual({
      id: "c1",
      phone: "9876543210",
      name: "Asha",
      firstSeen: "2026-01-01T00:00:00Z",
      visitCount: 3,
      totalSpend: 1250.5,
      lastPurchase: "2026-06-30T10:00:00Z",
    });
  });

  it("keeps a null last_purchase as null (customer with no active bills)", () => {
    const c = mapCustomer({
      id: "c2",
      phone: "1112223334",
      name: "",
      first_seen: "2026-02-01T00:00:00Z",
      visit_count: 0,
      total_spend: 0,
      last_purchase: null,
    });
    expect(c.lastPurchase).toBeNull();
    expect(c.visitCount).toBe(0);
    expect(c.totalSpend).toBe(0);
  });
});

describe("mapBill", () => {
  const baseRow = {
    id: "b1",
    bill_no: 42,
    customer_name: "Asha",
    customer_phone: "9876543210",
    subtotal: 100,
    tax: 5,
    total: 105,
    tax_rate: 5,
    payment_method: "Cash" as const,
    discount_percent: 0,
    discount_type: "percent" as const,
    discount_amount: 0,
    status: "active" as const,
    created_at: "2026-06-30T10:00:00Z",
    cancelled_at: null,
    cancelled_by: null,
    biller_name: "",
  };

  it("carries customer_id through as customerId", () => {
    expect(mapBill({ ...baseRow, customer_id: "c1" }, []).customerId).toBe("c1");
  });

  it("maps a null customer_id (legacy bill) to undefined", () => {
    expect(mapBill({ ...baseRow, customer_id: null }, []).customerId).toBeUndefined();
  });
});

describe("mapItem", () => {
  const row = {
    id: "i1", name: "Bread", emoji: "🍞", category: "Breads", unit: "pcs",
    price: 40, cost_price: 20, qty: 5, tracks_expiry: true,
    earliest_expiry: null, batches: null,
  };

  it("maps image_url to imageUrl", () => {
    expect(mapItem({ ...row, image_url: "https://x/y.webp" }).imageUrl)
      .toBe("https://x/y.webp");
  });

  it("maps a null image_url to null (emoji-only item)", () => {
    expect(mapItem({ ...row, image_url: null }).imageUrl).toBeNull();
  });
});
