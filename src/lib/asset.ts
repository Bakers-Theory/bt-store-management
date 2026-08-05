import type {
  AssetCondition,
  AssetStatus,
  MaintenanceKind,
} from "./types";

/**
 * Pure asset lifecycle logic.
 *
 * `ASSET_TRANSITIONS` and `assetActions` are MIRRORS of
 * `assert_asset_transition()` and the permission gates in
 * `0061_asset_rpcs.sql`. The SQL copy is the authority — this exists so a screen
 * can hide an impossible button instead of offering it and failing. Same rule as
 * `attendance.ts`/`attendance_summary` and `expense.ts`/`save_expense`.
 */

export const ASSET_STATUSES: AssetStatus[] = [
  "available",
  "assigned",
  "under_repair",
  "maintenance",
  "lost",
  "damaged",
  "retired",
];

export const ASSET_CONDITIONS: Exclude<AssetCondition, "">[] = [
  "new",
  "good",
  "fair",
  "poor",
];

export const MAINTENANCE_KINDS: MaintenanceKind[] = ["repair", "service", "amc"];

/**
 * #91 §2.3. `lost` and `retired` are terminal, so they map to nothing. `damaged`
 * is NOT terminal: a damaged asset is routinely repaired or written off.
 */
export const ASSET_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  available: ["assigned", "under_repair", "maintenance", "lost", "damaged", "retired"],
  assigned: ["available", "under_repair", "maintenance", "lost", "damaged", "retired"],
  under_repair: ["available", "maintenance", "lost", "damaged", "retired"],
  maintenance: ["available", "under_repair", "lost", "damaged", "retired"],
  damaged: ["available", "under_repair", "lost", "retired"],
  lost: [],
  retired: [],
};

/** Terminal states keep their record forever but accept no further change. */
export const isTerminalAssetStatus = (s: AssetStatus): boolean =>
  ASSET_TRANSITIONS[s].length === 0;

export function canTransitionAsset(from: AssetStatus, to: AssetStatus): boolean {
  // A no-op is always allowed, matching the SQL: re-saving a status is not an
  // illegal move, it simply does nothing.
  if (from === to) return true;
  return ASSET_TRANSITIONS[from].includes(to);
}

export function assetStatusLabel(s: AssetStatus): string {
  switch (s) {
    case "available":
      return "Available";
    case "assigned":
      return "Assigned";
    case "under_repair":
      return "Under repair";
    case "maintenance":
      return "In maintenance";
    case "lost":
      return "Lost";
    case "damaged":
      return "Damaged";
    case "retired":
      return "Retired";
  }
}

export function assetStatusTone(
  s: AssetStatus,
): "good" | "info" | "warn" | "bad" | "muted" {
  switch (s) {
    case "available":
      return "good";
    case "assigned":
      return "info";
    case "under_repair":
    case "maintenance":
      return "warn";
    case "lost":
    case "damaged":
      return "bad";
    case "retired":
      return "muted";
  }
}

export function conditionLabel(c: AssetCondition): string {
  switch (c) {
    case "":
      return "Not recorded";
    case "new":
      return "New";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "poor":
      return "Poor";
  }
}

export function maintenanceKindLabel(k: MaintenanceKind): string {
  switch (k) {
    case "repair":
      return "Repair";
    case "service":
      return "Service";
    case "amc":
      return "AMC";
  }
}

// ─── Warranty & service windows ─────────────────────────────────────────────

export type WarrantyStatus = "none" | "active" | "expiring" | "expired";

/**
 * `daysLeft` comes from the view, which computes it against the STORE's
 * calendar — not the browser's — so two devices in different timezones agree on
 * what is due. Null means the asset has no warranty recorded.
 */
export function warrantyStatus(
  daysLeft: number | null,
  windowDays = 30,
): WarrantyStatus {
  if (daysLeft === null) return "none";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= windowDays) return "expiring";
  return "active";
}

export type ServiceStatus = "none" | "ok" | "due" | "overdue";

export function serviceStatus(
  daysLeft: number | null,
  windowDays = 30,
): ServiceStatus {
  if (daysLeft === null) return "none";
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= windowDays) return "due";
  return "ok";
}

// ─── What a user may actually do (§2.4) ─────────────────────────────────────

export type AssetAction =
  | "edit"
  | "archive"
  | "restore"
  | "delete"
  | "assign"
  | "return"
  | "transfer"
  | "repair"
  | "closeJob"
  | "markLost"
  | "markDamaged"
  | "retire"
  | "printQr";

export interface AssetPerms {
  canView: boolean;
  canEdit: boolean;
  /** Covers retiring as well as removing — both take an asset out for good. */
  canDelete: boolean;
  canAssign: boolean;
  canMaintain: boolean;
}

export interface AssetActionSubject {
  status: AssetStatus;
  isArchived: boolean;
  /** Non-null while the asset is in the workshop. */
  openMaintenanceId: string | null;
}

/**
 * The §2.4 operation table, gated by both the lifecycle and the caller's
 * permissions. Every entry has a matching server-side check in 0061 — this only
 * decides what a screen offers.
 */
export function assetActions(
  a: AssetActionSubject,
  perms: AssetPerms,
): AssetAction[] {
  const out: AssetAction[] = [];
  const terminal = isTerminalAssetStatus(a.status);
  const inWorkshop = a.openMaintenanceId !== null;

  if (perms.canView) out.push("printQr");
  if (perms.canEdit && !terminal) out.push("edit");

  if (perms.canEdit) {
    if (a.isArchived) out.push("restore");
    // An asset someone is holding cannot be filed away as inactive.
    else if (a.status !== "assigned" && !terminal) out.push("archive");
  }

  if (perms.canAssign && !a.isArchived) {
    if (a.status === "available") out.push("assign");
    if (a.status === "assigned") out.push("return", "transfer");
  }

  if (perms.canMaintain) {
    if (inWorkshop) out.push("closeJob");
    else if (!terminal) out.push("repair");
  }

  if (perms.canEdit) {
    if (canTransitionAsset(a.status, "lost") && a.status !== "lost")
      out.push("markLost");
    if (canTransitionAsset(a.status, "damaged") && a.status !== "damaged")
      out.push("markDamaged");
  }

  if (perms.canDelete) {
    if (canTransitionAsset(a.status, "retired") && a.status !== "retired")
      out.push("retire");
    // A soft delete needs the asset back in hand and the workshop job closed —
    // the same two guards delete_asset applies.
    if (a.status !== "assigned" && !inWorkshop) out.push("delete");
  }

  return out;
}

/**
 * The QR label encodes the asset code, which is immutable and unique — there is
 * no second barcode column that could disagree with it (0060 note 7).
 */
export const qrPayload = (code: string): string => code.trim().toUpperCase();
