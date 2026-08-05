"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { MAINTENANCE_KINDS, maintenanceKindLabel } from "@/lib/asset";
import {
  fetchSuppliers,
  rpcCloseAssetMaintenance,
  rpcSaveAssetMaintenance,
} from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { Asset, AssetMaintenance, MaintenanceKind, Supplier } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

/**
 * Opening and closing a workshop job. Two things worth knowing:
 *
 *  - Taking the asset out of service is part of OPENING the job, not a separate
 *    action, and it closes any open custody record on the way (0061 note 5).
 *  - The repair cost recorded here is for the Maintenance Report. The money
 *    itself is an expense — nothing on this screen touches the cash book.
 */
export function MaintenanceModal({
  asset,
  job,
  onClose,
  onDone,
}: {
  asset: Asset;
  /** The open job to close, or null to open a new one. */
  job: AssetMaintenance | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const user = useCurrentUser();
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());
  const canRetire = hasPermission(user, "assets.delete");

  const [kind, setKind] = useState<MaintenanceKind>("repair");
  const [vendorId, setVendorId] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [completedOn, setCompletedOn] = useState(today);
  const [cost, setCost] = useState(job ? String(job.cost) : "");
  const [nextServiceOn, setNextServiceOn] = useState("");
  const [amcStart, setAmcStart] = useState("");
  const [amcEnd, setAmcEnd] = useState("");
  const [amcRef, setAmcRef] = useState("");
  const [notes, setNotes] = useState("");
  const [takeOut, setTakeOut] = useState(true);
  const [toStatus, setToStatus] = useState<"available" | "damaged" | "retired">(
    "available",
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  const costValue = cost === "" ? 0 : Number(cost);

  const error = job
    ? completedOn > today
      ? "That date is in the future"
      : completedOn < job.startedOn
        ? `The job started on ${job.startedOn}`
        : !Number.isFinite(costValue) || costValue < 0
          ? "A cost cannot be negative"
          : nextServiceOn && nextServiceOn < completedOn
            ? "The next service cannot be due before this one finished"
            : null
    : startedOn > today
      ? "A job cannot have started in the future"
      : !Number.isFinite(costValue) || costValue < 0
        ? "A cost cannot be negative"
        : kind === "amc" && amcStart && amcEnd && amcEnd < amcStart
          ? "An AMC cannot end before it starts"
          : null;

  const submit = async () => {
    if (error) return;
    setSaving(true);
    try {
      if (job) {
        await rpcCloseAssetMaintenance({
          id: job.id,
          completedOn,
          cost: costValue,
          nextServiceOn: nextServiceOn || null,
          notes,
          toStatus,
        });
        toast("Job closed", "success");
      } else {
        await rpcSaveAssetMaintenance({
          assetId: asset.id,
          kind,
          vendorId: vendorId || null,
          startedOn,
          cost: costValue,
          nextServiceOn: nextServiceOn || null,
          amcStart: kind === "amc" ? amcStart || null : null,
          amcEnd: kind === "amc" ? amcEnd || null : null,
          amcRef: kind === "amc" ? amcRef : "",
          notes,
          takeOutOfService: takeOut,
        });
        toast(takeOut ? "Sent for service" : "Service recorded", "success");
      }
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record that", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={job ? `Close ${maintenanceKindLabel(job.kind)} job` : "Repair or service"}
      onClose={onClose}
    >
      <div className="space-y-3">
        <p className="rounded-[11px] bg-cream px-3 py-2 text-xs text-ink">
          <strong>{asset.name}</strong> <span className="text-ink-muted">{asset.code}</span>
        </p>

        {!job && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="min-w-0">
                <label className={labelCls} htmlFor="mt-kind">What kind</label>
                <select
                  id="mt-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as MaintenanceKind)}
                  className={inputCls}
                >
                  {MAINTENANCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {maintenanceKindLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="mt-start">Started on</label>
                <input
                  id="mt-start"
                  type="date"
                  max={today}
                  value={startedOn}
                  onChange={(e) => setStartedOn(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="mt-vendor">Who is doing it (optional)</label>
              <select
                id="mt-vendor"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className={inputCls}
              >
                <option value="">Not recorded</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {kind === "amc" && (
              <div className="space-y-2.5 rounded-[13px] border border-line bg-[#faf4ea] p-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="min-w-0">
                    <label className={labelCls} htmlFor="mt-amcs">Contract from</label>
                    <input
                      id="mt-amcs"
                      type="date"
                      value={amcStart}
                      onChange={(e) => setAmcStart(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className={labelCls} htmlFor="mt-amce">Contract until</label>
                    <input
                      id="mt-amce"
                      type="date"
                      value={amcEnd}
                      onChange={(e) => setAmcEnd(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls} htmlFor="mt-amcref">Contract reference</label>
                  <input
                    id="mt-amcref"
                    value={amcRef}
                    onChange={(e) => setAmcRef(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                checked={takeOut}
                onChange={(e) => setTakeOut(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Take it out of service
                <span className="block font-normal text-ink-muted">
                  {asset.status === "assigned"
                    ? `This also takes it back from ${asset.assignedToName}.`
                    : "Leave this off for a contract on a machine that is still in use."}
                </span>
              </span>
            </label>
          </>
        )}

        {job && (
          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0">
              <label className={labelCls} htmlFor="mt-done">Finished on</label>
              <input
                id="mt-done"
                type="date"
                max={today}
                value={completedOn}
                onChange={(e) => setCompletedOn(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="min-w-0">
              <label className={labelCls} htmlFor="mt-to">Asset is now</label>
              <select
                id="mt-to"
                value={toStatus}
                onChange={(e) =>
                  setToStatus(e.target.value as "available" | "damaged" | "retired")
                }
                className={inputCls}
              >
                <option value="available">Back in service</option>
                <option value="damaged">Still damaged</option>
                {canRetire && <option value="retired">Beyond repair — retire it</option>}
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="mt-cost">Cost ({currency})</label>
            <input
              id="mt-cost"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="mt-next">Next service due (optional)</label>
            <input
              id="mt-next"
              type="date"
              value={nextServiceOn}
              onChange={(e) => setNextServiceOn(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="mt-notes">Notes (optional)</label>
          <input
            id="mt-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
          />
        </div>

        <p className="rounded-[10px] bg-[#faf4ea] px-2.5 py-2 text-[11px] text-ink-muted">
          The cost is recorded against the asset for the maintenance report. Record
          the payment itself as an expense — this screen does not move any money.
        </p>

        {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}

        <button
          disabled={!!error || saving}
          onClick={() => void submit()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {job ? "Close the job" : takeOut ? "Send for service" : "Record it"}
        </button>
      </div>
    </Modal>
  );
}
