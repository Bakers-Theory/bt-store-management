/**
 * Supplier validation, mirrored by the CHECK constraints in
 * `0035_suppliers.sql` and re-checked inside `create_supplier` /
 * `update_supplier`. SQL is the authority; this exists so the form can refuse
 * an impossible record without a round trip — the same arrangement as
 * `computePay` and `payroll_compute`.
 */
import type { SupplierType } from "./types";

export const SUPPLIER_TYPES: SupplierType[] = ["external", "in_house"];

export const isSupplierType = (v: unknown): v is SupplierType =>
  v === "external" || v === "in_house";

export const supplierTypeLabel = (t: SupplierType): string =>
  t === "in_house" ? "In-house" : "External";

/** 6 digits, first digit not 0. */
export const isPinCode = (v: string): boolean => /^[1-9]\d{5}$/.test(v);

/** Exactly 10 digits, nothing else. */
export const isMobile = (v: string): boolean => /^\d{10}$/.test(v);

/** The standard 15-character GSTIN, upper-case only. */
export const isGstin = (v: string): boolean =>
  /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v);

/** Shape only — deliverability is not our problem. */
export const isEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** The editable half of a supplier: everything except id, code and timestamps. */
export interface SupplierInput {
  supplierType: SupplierType;
  name: string;
  businessName: string;
  contactPerson: string;
  mobile: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  pinCode: string;
  paymentTerms: string;
  notes: string;
}

export const EMPTY_SUPPLIER: SupplierInput = {
  supplierType: "external",
  name: "",
  businessName: "",
  contactPerson: "",
  mobile: "",
  email: "",
  gstin: "",
  address: "",
  city: "",
  state: "",
  pinCode: "",
  paymentTerms: "",
  notes: "",
};

/** FR-6's mandatory set — external suppliers only. */
const EXTERNAL_REQUIRED: { field: keyof SupplierInput; label: string }[] = [
  { field: "businessName", label: "Business name" },
  { field: "contactPerson", label: "Contact person" },
  { field: "mobile", label: "Mobile" },
  { field: "address", label: "Address" },
  { field: "city", label: "City" },
  { field: "state", label: "State" },
  { field: "pinCode", label: "PIN code" },
  { field: "paymentTerms", label: "Payment terms" },
];

/**
 * Field name → message. An empty object means valid.
 *
 * In-house suppliers need only a name and a contact person: there is no
 * invoice, no payable and nobody to chase, so demanding a postal address would
 * be paperwork for its own sake. A GSTIN on an in-house row is refused outright
 * rather than ignored — the database refuses it too.
 */
export function validateSupplier(input: SupplierInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const v = (field: keyof SupplierInput) => input[field].trim();

  if (!v("name")) errors.name = "Name is required.";
  if (!v("contactPerson")) errors.contactPerson = "Contact person is required.";

  if (input.supplierType === "external") {
    for (const { field, label } of EXTERNAL_REQUIRED) {
      if (!v(field)) errors[field] = `${label} is required.`;
    }
    if (v("mobile") && !isMobile(v("mobile"))) {
      errors.mobile = "Mobile must be 10 digits.";
    }
    if (v("pinCode") && !isPinCode(v("pinCode"))) {
      errors.pinCode = "PIN code must be 6 digits and cannot start with 0.";
    }
  } else {
    // Not "ignored if present" — a GSTIN here means the record was filed under
    // the wrong type, and silently dropping it would hide that.
    if (v("gstin")) errors.gstin = "An in-house supplier cannot have a GSTIN.";
  }

  if (v("email") && !isEmail(v("email"))) errors.email = "That email doesn't look right.";
  if (v("gstin") && input.supplierType === "external" && !isGstin(v("gstin"))) {
    errors.gstin = "A GSTIN is 15 characters, like 27AAPFU0939F1ZV.";
  }

  return errors;
}
