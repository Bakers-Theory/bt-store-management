import { describe, expect, it } from "vitest";
import {
  ASSET_STATUSES,
  ASSET_TRANSITIONS,
  assetActions,
  assetStatusLabel,
  canTransitionAsset,
  isTerminalAssetStatus,
  barcodePayload,
  serviceStatus,
  warrantyStatus,
  type AssetActionSubject,
  type AssetPerms,
} from "./asset";
import type { AssetStatus } from "./types";

const admin: AssetPerms = {
  canView: true,
  canEdit: true,
  canDelete: true,
  canAssign: true,
  canMaintain: true,
};

const manager: AssetPerms = { ...admin, canDelete: false };

const viewer: AssetPerms = {
  canView: true,
  canEdit: false,
  canDelete: false,
  canAssign: false,
  canMaintain: false,
};

const subject = (over: Partial<AssetActionSubject> = {}): AssetActionSubject => ({
  status: "available",
  isArchived: false,
  openMaintenanceId: null,
  ...over,
});

describe("the asset lifecycle (§2.3)", () => {
  it("runs the normal loop: available → assigned → available", () => {
    expect(canTransitionAsset("available", "assigned")).toBe(true);
    expect(canTransitionAsset("assigned", "available")).toBe(true);
  });

  it("treats lost and retired as terminal, and nothing else", () => {
    const terminal = ASSET_STATUSES.filter(isTerminalAssetStatus);
    expect(terminal.sort()).toEqual(["lost", "retired"]);
  });

  it("lets a repair or maintenance resolve only the four ways §2.3 allows", () => {
    // "must return to Available or move to Lost / Damaged / Retired" — plus the
    // sideways move between the two temporary states.
    expect(ASSET_TRANSITIONS.under_repair.sort()).toEqual([
      "available",
      "damaged",
      "lost",
      "maintenance",
      "retired",
    ]);
  });

  it("keeps damaged recoverable — it is not a terminal state", () => {
    expect(isTerminalAssetStatus("damaged")).toBe(false);
    expect(canTransitionAsset("damaged", "under_repair")).toBe(true);
    expect(canTransitionAsset("damaged", "available")).toBe(true);
  });

  it("refuses to bring a lost or retired asset back", () => {
    expect(canTransitionAsset("lost", "available")).toBe(false);
    expect(canTransitionAsset("retired", "available")).toBe(false);
    expect(canTransitionAsset("retired", "assigned")).toBe(false);
  });

  it("allows a no-op, matching assert_asset_transition", () => {
    for (const s of ASSET_STATUSES) expect(canTransitionAsset(s, s)).toBe(true);
  });

  it("never lists a status as a transition to itself", () => {
    for (const s of ASSET_STATUSES) {
      expect(ASSET_TRANSITIONS[s]).not.toContain(s);
    }
  });

  it("has a label for every status", () => {
    for (const s of ASSET_STATUSES) expect(assetStatusLabel(s)).not.toBe("");
  });
});

describe("assetActions (§2.4)", () => {
  it("offers issue on an available asset, and transfer/return once it is out", () => {
    expect(assetActions(subject(), admin)).toContain("assign");
    expect(assetActions(subject(), admin)).not.toContain("return");

    const out = assetActions(subject({ status: "assigned" }), admin);
    expect(out).toContain("return");
    expect(out).toContain("transfer");
    expect(out).not.toContain("assign");
  });

  it("never offers to archive or delete an asset someone is holding", () => {
    const out = assetActions(subject({ status: "assigned" }), admin);
    expect(out).not.toContain("archive");
    expect(out).not.toContain("delete");
  });

  it("swaps archive for restore once archived, and stops issuing it", () => {
    const out = assetActions(subject({ isArchived: true }), admin);
    expect(out).toContain("restore");
    expect(out).not.toContain("archive");
    expect(out).not.toContain("assign");
  });

  it("offers closing the job instead of opening another while in the workshop", () => {
    const out = assetActions(
      subject({ status: "under_repair", openMaintenanceId: "m1" }),
      admin,
    );
    expect(out).toContain("closeJob");
    expect(out).not.toContain("repair");
    // delete_asset refuses while a job is open, so nor does the menu.
    expect(out).not.toContain("delete");
  });

  it("keeps retiring to the delete permission, not the edit one", () => {
    expect(assetActions(subject(), manager)).not.toContain("retire");
    expect(assetActions(subject(), admin)).toContain("retire");
  });

  it("still lets a Manager report an asset lost or damaged", () => {
    const out = assetActions(subject(), manager);
    expect(out).toContain("markLost");
    expect(out).toContain("markDamaged");
  });

  it("offers nothing but printing a label to a read-only user", () => {
    expect(assetActions(subject(), viewer)).toEqual(["printLabel"]);
  });

  it("offers no state change at all on a terminal asset", () => {
    for (const status of ["lost", "retired"] as AssetStatus[]) {
      const out = assetActions(subject({ status }), admin);
      expect(out).not.toContain("edit");
      expect(out).not.toContain("assign");
      expect(out).not.toContain("repair");
      expect(out).not.toContain("markLost");
      expect(out).not.toContain("markDamaged");
      expect(out).not.toContain("retire");
    }
  });

  it("does not offer the status an asset already has", () => {
    expect(assetActions(subject({ status: "damaged" }), admin)).not.toContain(
      "markDamaged",
    );
  });
});

describe("warranty & service windows", () => {
  it("reads nothing into a missing date", () => {
    expect(warrantyStatus(null)).toBe("none");
    expect(serviceStatus(null)).toBe("none");
  });

  it("splits the warranty three ways around the window", () => {
    expect(warrantyStatus(-1)).toBe("expired");
    expect(warrantyStatus(0)).toBe("expiring");
    expect(warrantyStatus(30)).toBe("expiring");
    expect(warrantyStatus(31)).toBe("active");
  });

  it("calls a service overdue only once the date has passed", () => {
    expect(serviceStatus(-1)).toBe("overdue");
    expect(serviceStatus(0)).toBe("due");
    expect(serviceStatus(30)).toBe("due");
    expect(serviceStatus(31)).toBe("ok");
  });

  it("honours a narrower window", () => {
    expect(warrantyStatus(20, 7)).toBe("active");
    expect(serviceStatus(5, 7)).toBe("due");
  });
});

describe("barcodePayload", () => {
  it("encodes the immutable asset code and nothing else", () => {
    expect(barcodePayload(" bt-ast-007 ")).toBe("BT-AST-007");
  });
});
