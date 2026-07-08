import { describe, it, expect } from "vitest";
import { groupLists, mapCustomer, mapBill } from "./supabase-data";

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
