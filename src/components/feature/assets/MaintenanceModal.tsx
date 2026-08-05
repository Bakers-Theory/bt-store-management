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
  draftToInput,
  emptyLinkedExpense,
  linkedExpenseError,
} from "@/lib/linked-expense";
import { LinkedExpenseFields } from "@/components/feature/cashbook/LinkedExpenseFields";
import {
  fetchJobExpense,
  fetchSuppliers,
  rpcCloseAssetMaintenance,
  rpcSaveAssetMaintenance,
} from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type {
  Asset,
  AssetMaintenance,
  Expense,
  MaintenanceKind,
  Supplier,
} from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

/**
 * Opening and closing a workshop job. Two things worth knowing:
 *
 *  - Taking the asset out of service is part of OPENING the job, not a separate
 *    action, and it closes any open custody record on the way (0061 note 5).
 *  - The cost can be filed as an expense from here (0066), which is what puts it
 *    in the cash book. A job has ONE cost, so if it was already recorded when the
 *    job was opened, closing it says so instead of offering to record it twice.
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
  const [spend, setSpend] = useState(() =>
    emptyLinkedExpense(today, {
      canRecord: hasPermission(user, "expense.create"),
      canPay: hasPermission(user, "expense.pay"),
    }),
  );
  /** undefined while unknown, null when unbilled, the expense when already filed. */
  const [billed, setBilled] = useState<Expense | null | undefined>(
    job ? undefined : null,
  );

  useEffect(() => {
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    if (!job) return;
    // A failure here must not block closing the job: the server refuses a second
    // expense by name, so the worst case is a readable error rather than a
    // double posting.
    fetchJobExpense(job.id)
      .then(setBilled)
      .catch(() => setBilled(null));
  }, [job]);

  const costValue = cost === "" ? 0 : Number(cost);
  // Only once there is a cost. Sending a machine for repair before the bill
  // arrives is normal, and there is nothing to post until it does.
  const offerSpend = billed === null && Number.isFinite(costValue) && costValue > 0;
  const spendError = offerSpend ? linkedExpenseError(spend, costValue, today) : null;

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
    if (error || spendError) return;
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
          expense: offerSpend ? draftToInput(spend) : null,
        });
        toast(
          offerSpend && spend.record
            ? "Job closed and the cost filed in the cash book"
            : "Job closed",
          "success",
        );
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
          expense: offerSpend ? draftToInput(spend) : null,
        });
        toast(
          offerSpend && spend.record
            ? "Recorded, and the cost filed in the cash book"
            : takeOut
              ? "Sent for service"
              : "Service recorded",
          "success",
        );
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
                // Explicit size: the base layer gives every input width:100%.
                className="mt-0.5 h-4 w-4 shrink-0 accent-brown"
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

        {offerSpend ? (
          <LinkedExpenseFields
            draft={spend}
            onChange={setSpend}
            amount={Number.isFinite(costValue) ? costValue : 0}
            today={today}
            error={cost === "" ? null : spendError}
            vendorSuffix={`this ${maintenanceKindLabel(job ? job.kind : kind).toLowerCase()}`}
          />
        ) : billed ? (
          <p className="rounded-[10px] bg-[#faf4ea] px-2.5 py-2 text-[11px] text-ink-muted">
            This job&apos;s cost is already in the cash book as expense #
            {billed.expenseNo}. Change it there, not here.
          </p>
        ) : null}

        {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}

        <button
          disabled={!!error || !!spendError || saving}
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
