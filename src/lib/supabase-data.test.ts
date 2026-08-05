import { describe, it, expect } from "vitest";
import {
  groupLists,
  mapCashCategory,
  mapCashDay,
  mapCashEntry,
  mapCustomer,
  mapBill,
  mapExpense,
  mapExpenseEvent,
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
        { kind: "asset_category", value: "Vehicles" },
        { kind: "consumable_category", value: "Packaging" },
      ]),
    ).toEqual({
      categories: ["Breads", "Cakes"],
      units: ["pcs"],
      emojis: ["🥐"],
      reasons: ["Sold"],
      assetCategories: ["Vehicles"],
      consumableCategories: ["Packaging"],
    });
  });

  it("yields empty arrays for absent kinds", () => {
    expect(groupLists([])).toEqual({
      categories: [], emojis: [], units: [], reasons: [],
      assetCategories: [], consumableCategories: [],
    });
  });

  it("ignores unknown kinds", () => {
    expect(groupLists([{ kind: "bogus", value: "x" }])).toEqual({
      categories: [], emojis: [], units: [], reasons: [],
      assetCategories: [], consumableCategories: [],
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
    shortfall: 0,
    shortfall_note: "",
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

  it("carries a shortfall and its note through", () => {
    const b = mapBill(
      { ...baseRow, customer_id: null, shortfall: 2, shortfall_note: "no change" },
      [],
    );
    expect(b.shortfall).toBe(2);
    expect(b.shortfallNote).toBe("no change");
  });

  it("coerces a numeric-as-string shortfall and defaults a missing one to 0", () => {
    // Postgres numeric can arrive as a string over the wire, and a bill cached
    // before this feature has no column at all.
    expect(mapBill({ ...baseRow, customer_id: null, shortfall: "2.50" as unknown as number }, []).shortfall).toBe(2.5);
    expect(mapBill({ ...baseRow, customer_id: null, shortfall: undefined as unknown as number }, []).shortfall).toBe(0);
  });
});

describe("mapExpense", () => {
  const row = {
    id: "x1",
    expense_no: 42,
    expense_date: "2026-07-28",
    paid_on: "2026-07-31",
    category_id: "c1",
    category_name: "Cake Boxes",
    category_group: "Packaging",
    category_path: "Packaging › Cake Boxes",
    vendor_name: "Packaging Co",
    vendor_supplier_id: null,
    vendor_display: "Packaging Co",
    // Postgres numeric arrives as a STRING over the wire.
    amount: "5000.00",
    gst_included: true,
    gst_amount: "250.00",
    payment_mode: "Mixed",
    split_cash: "2000.00",
    split_bank: "3000.00",
    split_bank_mode: "UPI",
    invoice_no: "PC-119",
    description: "boxes",
    paid_by_name: "Ravi",
    approved_by_name: "Asha",
    status: "paid",
    reject_reason: "",
    cancel_reason: "",
    created_by: "u1",
    created_by_name: "Ravi",
    created_at: "2026-07-28T05:00:00.000Z",
    updated_by_name: "Asha",
    updated_at: "2026-07-31T09:00:00.000Z",
  };

  it("coerces every money column to a number", () => {
    const e = mapExpense(row as never);
    expect(e.amount).toBe(5000);
    expect(e.gstAmount).toBe(250);
    expect(e.splitCash).toBe(2000);
    expect(e.splitBank).toBe(3000);
  });

  it("keeps the two dates distinct — incurred is not paid", () => {
    const e = mapExpense(row as never);
    expect(e.expenseDate).toBe("2026-07-28");
    expect(e.paidOn).toBe("2026-07-31");
  });

  it("leaves paidOn null on a pending expense", () => {
    const e = mapExpense({ ...row, paid_on: null, status: "pending" } as never);
    expect(e.paidOn).toBeNull();
    expect(e.status).toBe("pending");
  });

  it("prefers a linked supplier's name for the vendor display", () => {
    const e = mapExpense({
      ...row,
      vendor_supplier_id: "s1",
      vendor_display: "Amul Distributors",
    } as never);
    expect(e.vendorSupplierId).toBe("s1");
    expect(e.vendorDisplay).toBe("Amul Distributors");
    // The typed name survives alongside it.
    expect(e.vendorName).toBe("Packaging Co");
  });
});

describe("mapExpenseEvent", () => {
  it("maps an edit's field diff through unchanged", () => {
    const ev = mapExpenseEvent({
      id: "e1",
      expense_id: "x1",
      event: "edited",
      at: "2026-07-30T05:00:00.000Z",
      actor_name: "Asha",
      detail: { amount: [5000, 4800] },
    } as never);
    expect(ev.event).toBe("edited");
    expect(ev.actorName).toBe("Asha");
    expect(ev.detail).toEqual({ amount: [5000, 4800] });
  });

  it("defaults a null detail to an empty object", () => {
    const ev = mapExpenseEvent({
      id: "e2",
      expense_id: "x1",
      event: "created",
      at: "2026-07-28T05:00:00.000Z",
      actor_name: "Ravi",
      detail: null,
    } as never);
    expect(ev.detail).toEqual({});
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
