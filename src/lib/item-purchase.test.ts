import { describe, expect, it } from "vitest";
import {
  emptyItemPurchaseDraft,
  itemPurchaseError,
  linesFrom,
  withoutOpeningQty,
  type OpeningStock,
} from "./item-purchase";

const TODAY = "2026-08-14";

describe("emptyItemPurchaseDraft", () => {
  it("starts ticked and dated today — a delivery is the common case", () => {
    expect(emptyItemPurchaseDraft(TODAY)).toEqual({
      record: true,
      invoiceNo: "",
      purchaseDate: TODAY,
    });
  });
});

describe("itemPurchaseError", () => {
  const draft = (over = {}) => ({ ...emptyItemPurchaseDraft(TODAY), ...over });

  it("says nothing about an unticked block", () => {
    expect(itemPurchaseError(draft({ record: false }), "external", TODAY)).toBeNull();
    // Not even when the fields it would need are empty or wrong.
    expect(
      itemPurchaseError(draft({ record: false, purchaseDate: "" }), "external", TODAY),
    ).toBeNull();
  });

  it("requires an invoice number from an external supplier", () => {
    expect(itemPurchaseError(draft(), "external", TODAY)).toBe(
      "Enter the supplier's invoice number",
    );
    expect(itemPurchaseError(draft({ invoiceNo: "   " }), "external", TODAY)).toBe(
      "Enter the supplier's invoice number",
    );
    expect(itemPurchaseError(draft({ invoiceNo: "4471" }), "external", TODAY)).toBeNull();
  });

  it("asks an in-house receipt for no invoice number", () => {
    expect(itemPurchaseError(draft(), "in_house", TODAY)).toBeNull();
  });

  it("refuses a missing or future purchase date", () => {
    expect(itemPurchaseError(draft({ invoiceNo: "1", purchaseDate: "" }), "external", TODAY)).toBe(
      "Choose the purchase date",
    );
    expect(
      itemPurchaseError(draft({ invoiceNo: "1", purchaseDate: "2026-08-15" }), "external", TODAY),
    ).toBe("A purchase date cannot be in the future");
    // Backdating is fine — a delivery entered a week late is still that delivery.
    expect(
      itemPurchaseError(draft({ invoiceNo: "1", purchaseDate: "2026-08-01" }), "external", TODAY),
    ).toBeNull();
  });
});

describe("linesFrom", () => {
  const stock = (over: Partial<OpeningStock> = {}): OpeningStock => ({
    itemId: "i1",
    qty: 5,
    costPrice: 45,
    gstRate: 12,
    expiryDate: null,
    ...over,
  });

  it("maps opening stock onto an invoice line", () => {
    expect(linesFrom([stock({ expiryDate: "2026-12-01" })])).toEqual([
      { itemId: "i1", qty: 5, unitCost: 45, gstRate: 12, expiry: "2026-12-01" },
    ]);
  });

  it("leaves out products with no opening stock rather than sending a zero line", () => {
    const lines = linesFrom([
      stock({ itemId: "a", qty: 5 }),
      stock({ itemId: "b", qty: 0 }),
      stock({ itemId: "c", qty: 2 }),
    ]);
    expect(lines.map((l) => l.itemId)).toEqual(["a", "c"]);
  });

  it("is empty when nothing has a quantity, so there is nothing to post", () => {
    expect(linesFrom([stock({ qty: 0 })])).toEqual([]);
  });
});

describe("withoutOpeningQty", () => {
  it("strips the quantity and the supplier, leaving everything else alone", () => {
    const input = { name: "Caps", qty: 5, costPrice: 45, supplierId: "s1" };
    expect(withoutOpeningQty(input)).toEqual({
      name: "Caps",
      qty: 0,
      costPrice: 45,
      supplierId: null,
    });
  });

  it("does not mutate its argument", () => {
    const input = { qty: 5, supplierId: "s1" };
    withoutOpeningQty(input);
    expect(input).toEqual({ qty: 5, supplierId: "s1" });
  });
});
