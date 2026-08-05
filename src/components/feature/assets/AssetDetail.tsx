"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  Loader2,
  Printer,
  Trash2,
  UserPlus,
  UserMinus,
  Wrench,
  XCircle,
  AlertTriangle,
  PackageX,
  Pencil,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import {
  assetActions,
  assetStatusLabel,
  conditionLabel,
  maintenanceKindLabel,
  qrPayload,
  serviceStatus,
  warrantyStatus,
  type AssetAction,
} from "@/lib/asset";
import { canEncode } from "@/lib/barcode";
import { formatDateFull } from "@/lib/format";
import {
  fetchAsset,
  fetchAssetAssignments,
  fetchAssetEvents,
  fetchAssetMaintenance,
  rpcArchiveAsset,
  rpcDeleteAsset,
} from "@/lib/supabase-data";
import { AssignModal, type AssignMode } from "./AssignModal";
import { MaintenanceModal } from "./MaintenanceModal";
import { StatusModal, type StatusTarget } from "./StatusModal";
import type {
  Asset,
  AssetAssignment,
  AssetEvent,
  AssetMaintenance,
  Employee,
} from "@/lib/types";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// A date-only string must never go through `new Date()` — that parses as UTC
// midnight and renders the previous day in a negative-offset timezone.
const day = (ymd: string | null) => {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

const EVENT_LABELS: Record<AssetEvent["event"], string> = {
  created: "Added to the register",
  edited: "Details changed",
  assigned: "Issued",
  returned: "Returned",
  transferred: "Transferred",
  status_changed: "Status changed",
  maintenance_opened: "Service job opened",
  maintenance_closed: "Service job closed",
  archived: "Archived",
  restored: "Restored",
  deleted: "Removed",
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a6a3c]">
      {label}
    </p>
    <p className="truncate text-[13px] font-semibold text-ink">{value || "—"}</p>
  </div>
);

const ACTION_META: Record<
  AssetAction,
  { label: string; icon: typeof Wrench; danger?: boolean }
> = {
  edit: { label: "Edit", icon: Pencil },
  assign: { label: "Issue", icon: UserPlus },
  return: { label: "Take back", icon: UserMinus },
  transfer: { label: "Transfer", icon: ArrowLeftRight },
  repair: { label: "Repair / service", icon: Wrench },
  closeJob: { label: "Close job", icon: Wrench },
  markLost: { label: "Lost", icon: AlertTriangle, danger: true },
  markDamaged: { label: "Damaged", icon: XCircle, danger: true },
  retire: { label: "Retire", icon: PackageX, danger: true },
  archive: { label: "Archive", icon: Archive },
  restore: { label: "Restore", icon: ArchiveRestore },
  delete: { label: "Remove", icon: Trash2, danger: true },
  printQr: { label: "Print label", icon: Printer },
};

/**
 * One asset, everything about it: the register entry, the actions §2.4 allows in
 * its current state, its custody trail, its service history and its timeline.
 *
 * Which buttons appear comes from `assetActions()` — the mirror of the server's
 * gates — so a button is never offered that the RPC would refuse.
 */
export function AssetDetail({
  assetId,
  holders,
  onClose,
  onEdit,
  onChanged,
}: {
  assetId: string;
  holders: Employee[];
  onClose: () => void;
  onEdit: (a: Asset) => void;
  onChanged: () => void;
}) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const requireOwnerAuth = useUIStore((s) => s.requireOwnerAuth);
  const requestLabel = useUIStore((s) => s.requestLabel);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [custody, setCustody] = useState<AssetAssignment[]>([]);
  const [jobs, setJobs] = useState<AssetMaintenance[]>([]);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assignMode, setAssignMode] = useState<AssignMode | null>(null);
  const [maintaining, setMaintaining] = useState(false);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [tab, setTab] = useState<"custody" | "service" | "history">("custody");

  const load = useCallback(() => {
    Promise.all([
      fetchAsset(assetId),
      fetchAssetAssignments({ assetId }),
      fetchAssetMaintenance({ assetId }),
      fetchAssetEvents(assetId),
    ])
      .then(([a, c, m, e]) => {
        setAsset(a);
        setCustody(c);
        setJobs(m);
        setEvents(e);
      })
      .catch(() => toast("Couldn't load the asset", "error"))
      .finally(() => setLoaded(true));
  }, [assetId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const afterAction = () => {
    setAssignMode(null);
    setMaintaining(false);
    setStatusTarget(null);
    load();
    onChanged();
  };

  const archive = async (archived: boolean) => {
    if (!asset) return;
    setBusy(true);
    try {
      await rpcArchiveAsset(asset.id, archived);
      toast(archived ? "Asset archived" : "Asset restored", "success");
      afterAction();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not archive", "error");
    } finally {
      setBusy(false);
    }
  };

  // Removal leaves no trail in the register itself, so it goes through the
  // owner-password gate like the app's other destructive actions.
  const remove = () => {
    if (!asset) return;
    requireOwnerAuth(`Remove ${asset.code}`, async () => {
      setBusy(true);
      try {
        await rpcDeleteAsset(asset.id);
        toast("Asset removed", "success");
        onChanged();
        onClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not remove the asset", "error");
      } finally {
        setBusy(false);
      }
    });
  };

  const printLabel = () => {
    if (!asset) return;
    if (!canEncode(asset.code)) {
      toast("This code cannot go on a barcode label", "error");
      return;
    }
    requestLabel({
      code: qrPayload(asset.code),
      name: asset.name,
      category: asset.category,
      location: asset.location,
      copies: 1,
    });
  };

  const run = (action: AssetAction) => {
    if (!asset) return;
    switch (action) {
      case "edit":
        return onEdit(asset);
      case "assign":
        return setAssignMode("assign");
      case "return":
        return setAssignMode("return");
      case "transfer":
        return setAssignMode("transfer");
      case "repair":
      case "closeJob":
        return setMaintaining(true);
      case "markLost":
        return setStatusTarget("lost");
      case "markDamaged":
        return setStatusTarget("damaged");
      case "retire":
        return setStatusTarget("retired");
      case "archive":
        return void archive(true);
      case "restore":
        return void archive(false);
      case "delete":
        return remove();
      case "printQr":
        return printLabel();
    }
  };

  if (!loaded) {
    return (
      <Modal title="Asset" onClose={onClose}>
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[12px]" />
          ))}
        </div>
      </Modal>
    );
  }

  if (!asset) {
    return (
      <Modal title="Asset" onClose={onClose}>
        <p className="py-6 text-center text-sm text-ink-muted">
          This asset is no longer available.
        </p>
      </Modal>
    );
  }

  const openJob = jobs.find((j) => j.status === "open") ?? null;
  const actions = assetActions(
    {
      status: asset.status,
      isArchived: asset.isArchived,
      openMaintenanceId: asset.openMaintenanceId,
    },
    {
      canView: hasPermission(user, "assets.view"),
      canEdit: hasPermission(user, "assets.edit"),
      canDelete: hasPermission(user, "assets.delete"),
      canAssign: hasPermission(user, "assets.assign"),
      canMaintain: hasPermission(user, "assets.maintain"),
    },
  );
  const warranty = warrantyStatus(asset.warrantyDaysLeft);
  const service = serviceStatus(asset.serviceDaysLeft);
  const money = (n: number) => `${currency}${n.toLocaleString("en-IN")}`;

  return (
    <>
      <Modal title={`${asset.name} · ${asset.code}`} onClose={onClose}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[#f3e6d2] px-2 py-0.5 text-[11px] font-bold text-[#8a6a3c]">
              {assetStatusLabel(asset.status)}
            </span>
            {asset.assignedToName && (
              <span className="text-xs text-ink-muted">with {asset.assignedToName}</span>
            )}
            {asset.isArchived && (
              <span className="rounded bg-[#f3e6d2] px-2 py-0.5 text-[11px] font-bold text-[#8a6a3c]">
                Archived
              </span>
            )}
          </div>

          {(warranty === "expired" || warranty === "expiring" || service !== "ok") &&
            (warranty !== "none" || service !== "none") && (
              <div className="space-y-1 rounded-[12px] bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                {warranty === "expiring" && (
                  <p>Warranty ends in {asset.warrantyDaysLeft} day(s).</p>
                )}
                {warranty === "expired" && <p>Warranty has expired.</p>}
                {service === "due" && <p>Service due in {asset.serviceDaysLeft} day(s).</p>}
                {service === "overdue" && (
                  <p>Service overdue by {Math.abs(asset.serviceDaysLeft ?? 0)} day(s).</p>
                )}
              </div>
            )}

          <div className="grid grid-cols-2 gap-2.5 rounded-[14px] border border-line bg-warm-white p-3 sm:grid-cols-3">
            <Row label="Category" value={asset.category} />
            <Row label="Kept at" value={asset.location} />
            <Row label="Department" value={asset.department} />
            <Row label="Brand / model" value={[asset.brand, asset.model].filter(Boolean).join(" ")} />
            <Row label="Serial" value={asset.serialNumber} />
            <Row label="Condition" value={conditionLabel(asset.condition)} />
            <Row label="Bought on" value={day(asset.purchaseDate)} />
            <Row label="Cost" value={money(asset.purchasePrice)} />
            <Row label="Vendor" value={asset.vendorName} />
            <Row label="Warranty until" value={day(asset.warrantyExpiry)} />
            <Row label="Last service" value={day(asset.lastServiceDate)} />
            <Row label="Next service" value={day(asset.nextServiceDate)} />
          </div>

          {asset.notes && (
            <p className="rounded-[12px] bg-cream px-3 py-2 text-xs text-ink">{asset.notes}</p>
          )}

          {/* Only the actions the asset's state and the user's permissions both
              allow (§2.4). */}
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => {
              const meta = ACTION_META[a];
              const Icon = meta.icon;
              return (
                <button
                  key={a}
                  disabled={busy}
                  onClick={() => run(a)}
                  className={`inline-flex items-center gap-1.5 rounded-[11px] border px-2.5 py-2 text-xs font-bold disabled:opacity-50 ${
                    meta.danger
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-line bg-warm-white text-ink"
                  }`}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
                  {meta.label}
                </button>
              );
            })}
          </div>

          <div className="flex gap-1.5 border-b border-line">
            {(
              [
                ["custody", `Custody (${custody.length})`],
                ["service", `Service (${jobs.length})`],
                ["history", `History (${events.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-2.5 py-2 text-xs font-bold ${
                  tab === key
                    ? "border-brown text-ink"
                    : "border-transparent text-ink-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "custody" && (
            <div className="space-y-1.5">
              {custody.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-muted">
                  This asset has never been issued.
                </p>
              )}
              {custody.map((c) => (
                <div
                  key={c.id}
                  className="rounded-[12px] border border-line bg-warm-white px-3 py-2"
                >
                  <p className="text-[13px] font-bold text-ink">
                    {c.employeeName}
                    {c.isOpen && (
                      <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
                        Out now
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {day(c.assignedOn)} → {c.returnedOn ? day(c.returnedOn) : "—"}
                    {c.department && ` · ${c.department}`}
                    {c.assignedByName && ` · by ${c.assignedByName}`}
                  </p>
                  {(c.remarks || c.returnRemarks) && (
                    <p className="mt-0.5 text-[11px] text-ink">
                      {[c.remarks, c.returnRemarks].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "service" && (
            <div className="space-y-1.5">
              {jobs.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-muted">
                  No repairs or services recorded.
                </p>
              )}
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className="rounded-[12px] border border-line bg-warm-white px-3 py-2"
                >
                  <p className="text-[13px] font-bold text-ink">
                    {maintenanceKindLabel(j.kind)}
                    {j.status === "open" && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        Open
                      </span>
                    )}
                    <span className="ml-1.5 font-normal tabular-nums text-ink-muted">
                      {money(j.cost)}
                    </span>
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {day(j.startedOn)} → {j.completedOn ? day(j.completedOn) : "—"}
                    {j.vendorName && ` · ${j.vendorName}`}
                    {j.nextServiceOn && ` · next ${day(j.nextServiceOn)}`}
                  </p>
                  {j.kind === "amc" && (j.amcStart || j.amcEnd) && (
                    <p className="text-[11px] text-ink-muted">
                      Contract {day(j.amcStart)} → {day(j.amcEnd)}
                      {j.amcRef && ` · ${j.amcRef}`}
                    </p>
                  )}
                  {j.notes && <p className="mt-0.5 text-[11px] text-ink">{j.notes}</p>}
                </div>
              ))}
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-1.5">
              {events.map((e) => (
                <div key={e.id} className="flex gap-2 px-1 py-1.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c0a880]" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink">
                      {EVENT_LABELS[e.event]}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      {formatDateFull(e.at)}
                      {e.actorName && ` · ${e.actorName}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {assignMode && (
        <AssignModal
          asset={asset}
          mode={assignMode}
          holders={holders}
          onClose={() => setAssignMode(null)}
          onDone={afterAction}
        />
      )}

      {maintaining && (
        <MaintenanceModal
          asset={asset}
          job={openJob}
          onClose={() => setMaintaining(false)}
          onDone={afterAction}
        />
      )}

      {statusTarget && (
        <StatusModal
          asset={asset}
          target={statusTarget}
          onClose={() => setStatusTarget(null)}
          onDone={afterAction}
        />
      )}
    </>
  );
}
