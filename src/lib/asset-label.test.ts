import { describe, expect, it } from "vitest";
import {
  LABEL_KINDS,
  labelHasBarcode,
  labelHasQr,
  QR_COMFORTABLE_BYTES,
  assetLabelUrl,
  assetQrPayload,
  labelKindLabel,
  payloadBytes,
} from "./asset-label";
import type { Asset } from "./types";

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  code: "BT-AST-001",
  name: "POS machine",
  category: "Electronics",
  brand: "Ingenico",
  model: "ICT250",
  serialNumber: "SN-1234",
  purchaseDate: "2026-01-10",
  purchasePrice: 20000,
  vendorId: null,
  vendorName: "TechCo",
  warrantyStart: "2026-01-10",
  warrantyExpiry: "2027-01-09",
  location: "Front counter",
  department: "Counter",
  assignedTo: "e1",
  assignedToName: "Asha",
  status: "assigned",
  condition: "good",
  notes: "",
  imageUrl: null,
  documents: [],
  lastServiceDate: null,
  nextServiceDate: null,
  openAssignmentId: "s1",
  assignedOn: "2026-07-01",
  openMaintenanceId: null,
  openMaintenanceKind: null,
  warrantyDaysLeft: 157,
  serviceDaysLeft: null,
  isArchived: false,
  archivedAt: null,
  createdAt: "2026-01-10T00:00:00Z",
  createdByName: "Owner",
  updatedAt: "2026-01-10T00:00:00Z",
  updatedByName: "Owner",
  ...over,
});

describe("assetLabelUrl", () => {
  it("addresses the asset by code, not by row id", () => {
    // A code is what is printed and what a person can retype off a scuffed label.
    expect(assetLabelUrl("https://shop.example", "BT-AST-001")).toBe(
      "https://shop.example/assets?code=BT-AST-001",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(assetLabelUrl("https://shop.example/", "BT-AST-001")).toBe(
      "https://shop.example/assets?code=BT-AST-001",
    );
  });

  it("normalises and escapes the code", () => {
    expect(assetLabelUrl("https://x.dev", " bt-ast-001 ")).toBe(
      "https://x.dev/assets?code=BT-AST-001",
    );
    expect(assetLabelUrl("https://x.dev", "A B")).toContain("code=A%20B");
  });
});

describe("assetQrPayload", () => {
  const payload = assetQrPayload(asset(), "https://shop.example");

  it("leads with the link, because that is what a camera offers to open", () => {
    expect(payload.split("\n")[0]).toBe("https://shop.example/assets?code=BT-AST-001");
  });

  it("carries the durable facts as plain text for a reader with no signal", () => {
    expect(payload).toContain("BT-AST-001 — POS machine");
    expect(payload).toContain("Category: Electronics");
    expect(payload).toContain("Make: Ingenico ICT250");
    expect(payload).toContain("Serial: SN-1234");
    expect(payload).toContain("Bought: 10-01-2026");
    expect(payload).toContain("Warranty until: 09-01-2027");
  });

  it("omits everything that changes, so a printed label cannot start lying", () => {
    // Status, holder and location move every few months; the URL covers them.
    expect(payload).not.toContain("Asha");
    expect(payload).not.toContain("assigned");
    expect(payload).not.toContain("Front counter");
    expect(payload).not.toContain("Counter");
  });

  it("never prints the purchase price on a public sticker", () => {
    expect(payload).not.toContain("20000");
  });

  it("drops a line rather than printing an empty label", () => {
    const bare = assetQrPayload(
      asset({ brand: "", model: "", serialNumber: "", warrantyExpiry: null }),
      "https://x.dev",
    );
    expect(bare).not.toContain("Make:");
    expect(bare).not.toContain("Serial:");
    expect(bare).not.toContain("Warranty until:");
    expect(bare.split("\n")).toHaveLength(4); // url, code+name, category, bought
  });

  it("joins brand and model into one line, and copes with only one of them", () => {
    expect(assetQrPayload(asset({ model: "" }), "https://x.dev")).toContain(
      "Make: Ingenico",
    );
    expect(assetQrPayload(asset({ brand: "" }), "https://x.dev")).toContain("Make: ICT250");
  });

  it("stays well inside the size a small label can carry", () => {
    expect(payloadBytes(payload)).toBeLessThan(QR_COMFORTABLE_BYTES);
  });

  it("measures UTF-8 bytes, not characters", () => {
    // A name in another script costs more than its length suggests, which is what
    // decides whether a QR still scans at 25mm.
    expect(payloadBytes("ओवन")).toBeGreaterThan(3);
  });
});

describe("label kinds", () => {
  it("defaults to carrying both codes, since a stockroom has both readers", () => {
    expect(LABEL_KINDS[0]).toBe("both");
    expect(LABEL_KINDS).toEqual(["both", "barcode", "qr"]);
    for (const k of LABEL_KINDS) expect(labelKindLabel(k)).not.toBe("");
  });

  it("reports which codes each kind draws", () => {
    expect(LABEL_KINDS.filter(labelHasBarcode)).toEqual(["both", "barcode"]);
    expect(LABEL_KINDS.filter(labelHasQr)).toEqual(["both", "qr"]);
  });
});
