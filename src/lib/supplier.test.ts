import { describe, expect, it } from "vitest";
import {
  EMPTY_SUPPLIER,
  isGstin,
  isMobile,
  isPinCode,
  isSupplierType,
  validateSupplier,
  type SupplierInput,
} from "./supplier";

const external = (over: Partial<SupplierInput> = {}): SupplierInput => ({
  ...EMPTY_SUPPLIER,
  supplierType: "external",
  name: "Sharma Flour Mills",
  businessName: "Sharma Flour Mills Pvt Ltd",
  contactPerson: "Ravi Sharma",
  mobile: "9876543210",
  address: "12 Mill Road",
  city: "Pune",
  state: "Maharashtra",
  pinCode: "411001",
  paymentTerms: "Net 30",
  ...over,
});

describe("field validators", () => {
  it("accepts a 6-digit PIN that does not start with 0", () => {
    expect(isPinCode("411001")).toBe(true);
  });
  it("rejects a PIN starting with 0, or of the wrong length", () => {
    expect(isPinCode("011001")).toBe(false);
    expect(isPinCode("41100")).toBe(false);
    expect(isPinCode("4110012")).toBe(false);
    expect(isPinCode("41100a")).toBe(false);
  });
  it("accepts exactly 10 digits as a mobile", () => {
    expect(isMobile("9876543210")).toBe(true);
    expect(isMobile("98765 43210")).toBe(false);
    expect(isMobile("+919876543210")).toBe(false);
  });
  it("accepts a well-formed GSTIN and rejects a malformed one", () => {
    expect(isGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isGstin("27aapfu0939f1zv")).toBe(false);
    expect(isGstin("27AAPFU0939F1Z")).toBe(false);
  });
  it("narrows supplier types", () => {
    expect(isSupplierType("external")).toBe(true);
    expect(isSupplierType("in_house")).toBe(true);
    expect(isSupplierType("inhouse")).toBe(false);
  });
});

describe("validateSupplier — external", () => {
  it("passes a fully filled external supplier", () => {
    expect(validateSupplier(external())).toEqual({});
  });
  it("requires the full FR-6 mandatory set", () => {
    const errors = validateSupplier({
      ...EMPTY_SUPPLIER,
      supplierType: "external",
      name: "X",
    });
    for (const field of [
      "businessName", "contactPerson", "mobile",
      "address", "city", "state", "pinCode", "paymentTerms",
    ]) {
      expect(errors[field], `${field} should be required`).toBeTruthy();
    }
  });
  it("never requires email or GSTIN", () => {
    const errors = validateSupplier(external({ email: "", gstin: "" }));
    expect(errors.email).toBeUndefined();
    expect(errors.gstin).toBeUndefined();
  });
  it("checks email and GSTIN shape only when non-empty", () => {
    expect(validateSupplier(external({ email: "not-an-email" })).email).toBeTruthy();
    expect(validateSupplier(external({ gstin: "NOPE" })).gstin).toBeTruthy();
    expect(validateSupplier(external({ email: "ravi@mill.in" })).email).toBeUndefined();
  });
});

describe("validateSupplier — in-house", () => {
  const inHouse = (over: Partial<SupplierInput> = {}): SupplierInput => ({
    ...EMPTY_SUPPLIER,
    supplierType: "in_house",
    name: "Bakery Kitchen",
    contactPerson: "Head Baker",
    ...over,
  });

  it("requires only name and contact person", () => {
    expect(validateSupplier(inHouse())).toEqual({});
  });
  it("still flags a missing name or contact person", () => {
    expect(validateSupplier(inHouse({ name: "" })).name).toBeTruthy();
    expect(validateSupplier(inHouse({ contactPerson: "" })).contactPerson).toBeTruthy();
  });
  it("forbids a GSTIN outright, even a valid one", () => {
    expect(validateSupplier(inHouse({ gstin: "27AAPFU0939F1ZV" })).gstin).toBeTruthy();
  });
  it("does not require an address or payment terms", () => {
    const errors = validateSupplier(inHouse());
    expect(errors.address).toBeUndefined();
    expect(errors.paymentTerms).toBeUndefined();
  });
});
