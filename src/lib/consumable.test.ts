import { describe, expect, it } from "vitest";
import {
  MOVEMENT_TYPES,
  alertSeverity,
  movementDirection,
  movementError,
  movementTypeLabel,
  reasonRequired,
  recommendedQty,
  signedQty,
  stockAfter,
  stockStatusOf,
} from "./consumable";

describe("movement direction (§3.3)", () => {
  it("takes direction from the type, never from the sign typed", () => {
    // Wastage of 5 and an issue of 5 both take 5 out, however it was entered.
    expect(signedQty("wastage", 5)).toBe(-5);
    expect(signedQty("wastage", -5)).toBe(-5);
    expect(signedQty("issue", 5)).toBe(-5);
    expect(signedQty("purchase", 5)).toBe(5);
    expect(signedQty("purchase", -5)).toBe(5);
    expect(signedQty("return", 2.5)).toBe(2.5);
  });

  it("lets only an adjustment go either way, because a count can", () => {
    expect(movementDirection("adjustment")).toBe("either");
    expect(signedQty("adjustment", -3)).toBe(-3);
    expect(signedQty("adjustment", 3)).toBe(3);
    const either = MOVEMENT_TYPES.filter((t) => movementDirection(t) === "either");
    expect(either).toEqual(["adjustment"]);
  });

  it("requires a reason on exactly the four write-off types", () => {
    expect(MOVEMENT_TYPES.filter(reasonRequired)).toEqual([
      "adjustment",
      "wastage",
      "expired",
      "damaged",
    ]);
  });

  it("has a label for every type", () => {
    for (const t of MOVEMENT_TYPES) expect(movementTypeLabel(t)).not.toBe("");
  });
});

describe("stockAfter", () => {
  it("is the running total the ledger sum will produce", () => {
    expect(stockAfter(10, "purchase", 5)).toBe(15);
    expect(stockAfter(10, "issue", 4)).toBe(6);
    expect(stockAfter(10, "adjustment", -2)).toBe(8);
    expect(stockAfter(10, "return", 1)).toBe(11);
  });
});

describe("movementError — the block, not a flag (§3.4)", () => {
  it("refuses a movement that would take stock below zero", () => {
    expect(movementError(4, "issue", 5, "", "kg")).toBe("There is only 4 kg on hand");
    // A negative adjustment is blocked by the same rule.
    expect(movementError(4, "adjustment", -5, "count")).not.toBeNull();
  });

  it("allows a movement that lands exactly on zero", () => {
    expect(movementError(5, "issue", 5, "")).toBeNull();
  });

  it("never blocks stock coming in", () => {
    expect(movementError(0, "purchase", 5, "")).toBeNull();
    expect(movementError(0, "return", 5, "")).toBeNull();
  });

  it("insists on a positive quantity, except on an adjustment", () => {
    expect(movementError(10, "issue", 0, "")).toBe("A quantity has to be more than zero");
    expect(movementError(10, "issue", -1, "")).toBe("A quantity has to be more than zero");
    expect(movementError(10, "adjustment", 0, "count")).toBe(
      "An adjustment of zero changes nothing",
    );
  });

  it("insists on a reason before writing value off", () => {
    expect(movementError(10, "wastage", 1, "   ")).toBe(
      "Say why this stock is being written off",
    );
    expect(movementError(10, "wastage", 1, "Spoiled")).toBeNull();
    // An issue is ordinary use, so it needs no explanation.
    expect(movementError(10, "issue", 1, "")).toBeNull();
  });

  it("rejects a non-numeric quantity before anything else", () => {
    expect(movementError(10, "issue", Number.NaN, "")).toBe("Enter a quantity");
  });
});

describe("stockStatusOf", () => {
  it("calls zero or less out of stock", () => {
    expect(stockStatusOf(0, 5, null)).toBe("out");
    expect(stockStatusOf(-1, 5, null)).toBe("out");
  });

  it("calls anything under the minimum low", () => {
    expect(stockStatusOf(4.99, 5, null)).toBe("low");
    // Exactly at the minimum is not low — the minimum is the floor, not a breach.
    expect(stockStatusOf(5, 5, null)).toBe("ok");
  });

  it("reports the reorder level separately from the minimum (§3.2)", () => {
    expect(stockStatusOf(8, 5, 10)).toBe("reorder");
    expect(stockStatusOf(11, 5, 10)).toBe("ok");
  });

  it("prefers the more urgent tier when both apply", () => {
    expect(stockStatusOf(3, 5, 10)).toBe("low");
  });
});

describe("recommendedQty (§3.5)", () => {
  const base = { minStock: 10, maxStock: null, reorderLevel: null, reorderQty: null };

  it("recommends nothing while stock is healthy", () => {
    expect(recommendedQty({ ...base, current: 20 })).toBe(0);
  });

  it("tops back up to the ceiling when one is set", () => {
    expect(recommendedQty({ ...base, current: 4, maxStock: 50 })).toBe(46);
  });

  it("prefers a configured reorder quantity over the ceiling", () => {
    expect(
      recommendedQty({ ...base, current: 4, maxStock: 50, reorderQty: 25 }),
    ).toBe(25);
  });

  it("falls back to topping up to the minimum", () => {
    expect(recommendedQty({ ...base, current: 4 })).toBe(6);
  });

  it("recommends an order at the reorder level, before the minimum is breached", () => {
    // 12 is above the minimum of 10 but at the reorder level — the whole point of
    // §3.2 allowing the two to differ.
    expect(recommendedQty({ ...base, current: 12, reorderLevel: 12, maxStock: 40 })).toBe(
      28,
    );
  });

  it("never recommends a negative quantity", () => {
    // At the reorder level but already above the minimum, with no ceiling to fill
    // to: there is nothing to order, not a negative amount of it.
    expect(recommendedQty({ ...base, current: 12, reorderLevel: 15 })).toBe(0);
  });
});

describe("alertSeverity", () => {
  it("puts out-of-stock, low stock and expired in the act-now tier", () => {
    expect(alertSeverity("out_of_stock")).toBe(2);
    expect(alertSeverity("low_stock")).toBe(2);
    expect(alertSeverity("expired")).toBe(2);
    expect(alertSeverity("reorder")).toBe(1);
    expect(alertSeverity("expiring")).toBe(1);
    expect(alertSeverity("high_consumption")).toBe(1);
  });
});
