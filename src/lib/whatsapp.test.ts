import { describe, it, expect } from "vitest";
import { buildBillText, buildOfferText, whatsAppTargets } from "./whatsapp";
import type { Bakery, Bill, BillLine, Customer, LoyaltySettings } from "./types";

const bakery: Bakery = {
  name: "Baker's Theory",
  tagline: "Fresh daily",
  address: "12 Main St",
  phone: "9876543210",
  gst: "29ABCDE1234F1Z5",
  logo: null,
  currency: "₹",
  taxRate: 5,
  gstStateCode: "", pricesIncludeGst: true,
  loyalty: {
    enabled: false, pointsPerAmount: 1, pointsAmountUnit: 100, pointsPerRupee: 10,
    minRedeemPoints: 100, occasionDiscountPercent: 10, occasionDiscountCap: 200,
  },
  lowStockAlert: 5,
  expiringSoonDays: 3,
  isOpen: true,
  statusChangedAt: null,
  statusChangedBy: "",
};

const line = (name: string, qty: number, price: number): BillLine => ({
  itemId: "x", name, emoji: "🥐", imageUrl: null, unit: "pcs", qty, price, costPrice: 0,
  hsn: "", gstRate: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0,
});

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1",
  billNo: 1042,
  customerName: "Ravi",
  customerPhone: "9123456780",
  items: [line("Croissant", 2, 80), line("Brownie", 1, 120)],
  consumables: [],
  subtotal: 280,
  tax: 0,
  total: 280,
  taxRate: 5,
  invoiceType: "non_gst", invoiceNo: null, customerGstin: "", placeOfSupply: "",
  isInterstate: false, taxableValue: 0, cgst: 0, sgst: 0, igst: 0,
  paymentMethod: "UPI",
  discountPercent: 0,
  discountType: "percent",
  discountAmount: 0,
  shortfall: 0,
  shortfallNote: "",
  billerName: "Asha",
  date: "2026-07-27T12:45:00.000Z",
  status: "active",
  occasionKind: null, occasionDiscount: 0, pointsRedeemed: 0, pointsRedeemValue: 0, pointsEarned: 0,
  ...over,
});

/** The lines inside the ``` block, which is where the aligned table lives. */
const monoBlock = (text: string): string[] => {
  const all = text.split("\n");
  const open = all.indexOf("```");
  const close = all.indexOf("```", open + 1);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return all.slice(open + 1, close);
};

describe("buildBillText", () => {
  it("renders header, items, totals and footer", () => {
    const text = buildBillText(bill(), bakery);
    expect(text).toContain("*Baker's Theory*");
    expect(text).toContain("_Fresh daily_");
    expect(text).toContain("12 Main St");
    expect(text).toContain("GST: 29ABCDE1234F1Z5");
    expect(text).toContain("🧾 Bill #1042");
    expect(text).toContain("👤 Ravi");
    expect(text).toContain("🧑‍🍳 Billed by Asha");
    expect(text).toContain("💳 Paid via UPI");
    expect(text).toContain("_Thank you for your visit!_");
    expect(text).toContain("_Please come again_");
  });

  it("puts every item and total inside the monospace block", () => {
    const rows = monoBlock(buildBillText(bill(), bakery));
    expect(rows).toContain("Croissant");
    expect(rows).toContain("Brownie");
    expect(rows.some((r) => r.startsWith("  2 × ₹80.00") && r.endsWith("₹160.00"))).toBe(true);
    expect(rows.some((r) => r.startsWith("  1 × ₹120.00") && r.endsWith("₹120.00"))).toBe(true);
    expect(rows.some((r) => r.startsWith("Subtotal") && r.endsWith("₹280.00"))).toBe(true);
    expect(rows.some((r) => r.startsWith("TOTAL") && r.endsWith("₹280.00"))).toBe(true);
  });

  it("right-aligns every amount to a single column", () => {
    const rows = monoBlock(
      buildBillText(bill({ discountPercent: 10, discountAmount: 28, tax: 12.6, total: 264.6 }), bakery),
    );
    // Rows carrying an amount all end at the same column; bare item-name rows do not.
    const widths = new Set(rows.filter((r) => r.includes("₹")).map((r) => r.length));
    expect(widths).toEqual(new Set([24]));
  });

  it("keeps label and amount separated when a row would overflow", () => {
    const rows = monoBlock(buildBillText(bill({ items: [line("Cake", 1, 1234567.5)] }), bakery));
    const row = rows.find((r) => r.startsWith("  1 ×"))!;
    expect(row).toBe("  1 × ₹1234567.50 ₹1234567.50");
  });

  it("omits discount and tax rows when they are zero", () => {
    const text = buildBillText(bill(), bakery);
    expect(text).not.toContain("Discount");
    expect(text).not.toContain("Tax (");
  });

  it("labels a percentage discount with its rate", () => {
    const rows = monoBlock(
      buildBillText(bill({ discountType: "percent", discountPercent: 10, discountAmount: 28, total: 252 }), bakery),
    );
    expect(rows.some((r) => r.startsWith("Discount (10%)") && r.endsWith("-₹28.00"))).toBe(true);
  });

  it("labels a flat discount without a rate", () => {
    const rows = monoBlock(
      buildBillText(bill({ discountType: "flat", discountPercent: 0, discountAmount: 30, total: 250 }), bakery),
    );
    expect(rows.some((r) => r.startsWith("Discount ") && r.endsWith("-₹30.00"))).toBe(true);
    expect(rows.some((r) => r.startsWith("Discount ("))).toBe(false);
  });

  it("includes tax when non-zero", () => {
    const rows = monoBlock(buildBillText(bill({ tax: 14, total: 294 }), bakery));
    expect(rows.some((r) => r.startsWith("Tax (5%)") && r.endsWith("₹14.00"))).toBe(true);
  });

  it("omits optional bakery and customer fields when blank", () => {
    const text = buildBillText(
      bill({ customerName: "", billerName: "" }),
      { ...bakery, tagline: "", address: "", gst: "", phone: "" },
    );
    expect(text).not.toContain("👤");
    expect(text).not.toContain("🧑‍🍳");
    expect(text).not.toContain("GST:");
    expect(text).toContain("_Baker's Theory_");
  });

  it("leads with a cancelled banner", () => {
    expect(
      buildBillText(bill({ status: "cancelled" }), bakery).startsWith("⚠️ *THIS BILL WAS CANCELLED*"),
    ).toBe(true);
  });
});

describe("buildBillText with loyalty", () => {
  it("itemises the occasion discount and the points redeemed", () => {
    const b = bill({
      subtotal: 850, discountAmount: 177.5, discountPercent: 5, discountType: "percent",
      occasionKind: "birthday", occasionDiscount: 85,
      pointsRedeemed: 500, pointsRedeemValue: 50, pointsEarned: 6,
      total: 672.5,
    });
    const text = buildBillText(b, bakery);
    expect(text).toContain("Birthday offer");
    expect(text).toContain("Points redeemed (500)");
    expect(text).toContain("You earned 6 points");
  });

  it("prints nothing extra on a bill with no loyalty activity", () => {
    const text = buildBillText(bill(), bakery);
    expect(text).not.toContain("offer");
    expect(text).not.toContain("points");
  });
});

describe("whatsAppTargets", () => {
  const text = "hi there";
  const encoded = "hi%20there";

  it("uses wa.me with the 91-prefixed number on mobile, with no fallback", () => {
    expect(whatsAppTargets(text, "9123456780", true)).toEqual({
      primary: `https://wa.me/919123456780?text=${encoded}`,
    });
  });

  it("uses the app scheme on desktop with WhatsApp Web as the fallback", () => {
    expect(whatsAppTargets(text, "9123456780", false)).toEqual({
      primary: `whatsapp://send?phone=919123456780&text=${encoded}`,
      fallback: `https://web.whatsapp.com/send?phone=919123456780&text=${encoded}`,
    });
  });

  it("opens the chat picker when there is no phone", () => {
    expect(whatsAppTargets(text, "", true)).toEqual({ primary: `https://wa.me/?text=${encoded}` });
    expect(whatsAppTargets(text, undefined, false)).toEqual({
      primary: `whatsapp://send?text=${encoded}`,
      fallback: `https://wa.me/?text=${encoded}`,
    });
  });

  it("opens the chat picker for a phone that is not 10 digits", () => {
    expect(whatsAppTargets(text, "12345", true).primary).toBe(`https://wa.me/?text=${encoded}`);
    expect(whatsAppTargets(text, "919123456780", false).primary).toBe(`whatsapp://send?text=${encoded}`);
  });

  it("strips separators from a formatted 10-digit number", () => {
    expect(whatsAppTargets(text, "91234-56780", true).primary).toBe(`https://wa.me/919123456780?text=${encoded}`);
  });
});

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: "c1",
  phone: "9123456780",
  name: "Priya",
  firstSeen: "2026-01-01T00:00:00.000Z",
  visitCount: 1,
  totalSpend: 0,
  lastPurchase: null,
  gstin: "",
  stateCode: "",
  billingAddress: "",
  defaultInvoiceType: "non_gst",
  dob: null,
  anniversary: null,
  pointsBalance: 0,
  ...over,
});

describe("buildOfferText", () => {
  const settings: LoyaltySettings = {
    enabled: true, pointsPerAmount: 1, pointsAmountUnit: 100, pointsPerRupee: 10,
    minRedeemPoints: 100, occasionDiscountPercent: 10, occasionDiscountCap: 200,
  };

  it("greets the customer by name and names the occasion", () => {
    const text = buildOfferText(customer({ name: "Priya", pointsBalance: 0 }), bakery, "birthday", settings);
    expect(text).toContain("Priya");
    expect(text).toContain("Happy Birthday");
    expect(text).toContain("10%");
  });

  it("names the anniversary instead when that is the occasion", () => {
    const text = buildOfferText(customer({ name: "Priya", pointsBalance: 0 }), bakery, "anniversary", settings);
    expect(text).toContain("Happy Anniversary");
    expect(text).not.toContain("Happy Birthday");
  });

  it("mentions a point balance worth redeeming, and omits it when there is none", () => {
    const withPoints = buildOfferText(customer({ name: "Priya", pointsBalance: 500 }), bakery, "birthday", settings);
    expect(withPoints).toContain("500 points");
    const without = buildOfferText(customer({ name: "Priya", pointsBalance: 0 }), bakery, "birthday", settings);
    expect(without).not.toContain("points");
  });

  it("falls back to a generic greeting when no name is on record", () => {
    const text = buildOfferText(customer({ name: "", pointsBalance: 0 }), bakery, "birthday", settings);
    expect(text).toContain("Happy Birthday");
    expect(text).not.toContain("undefined");
  });
});
