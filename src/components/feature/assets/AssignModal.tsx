"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { ASSET_CONDITIONS, conditionLabel } from "@/lib/asset";
import {
  rpcAssignAsset,
  rpcReturnAsset,
  rpcTransferAsset,
} from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { Asset, AssetCondition, Employee } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

export type AssignMode = "assign" | "transfer" | "return";

const TITLES: Record<AssignMode, string> = {
  assign: "Issue asset",
  transfer: "Transfer asset",
  return: "Take asset back",
};

/**
 * The three custody actions, which share every field but the direction. A
 * transfer is deliberately ONE action rather than a return followed by an issue:
 * the server closes the old row and opens the new one on the same date, so the
 * trail has neither a gap nor an overlap (§2.4).
 */
export function AssignModal({
  asset,
  mode,
  holders,
  onClose,
  onDone,
}: {
  asset: Asset;
  mode: AssignMode;
  holders: Employee[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  const [employeeId, setEmployeeId] = useState("");
  const [onDate, setOnDate] = useState(today);
  const [department, setDepartment] = useState(asset.department);
  const [receivedById, setReceivedById] = useState("");
  const [remarks, setRemarks] = useState("");
  const [condition, setCondition] = useState<AssetCondition>("");
  const [saving, setSaving] = useState(false);

  const needsEmployee = mode !== "return";
  const error =
    needsEmployee && employeeId === ""
      ? "Choose who it is going to"
      : mode === "transfer" && employeeId === asset.assignedTo
        ? "That is who already has it"
        : onDate > today
          ? "That date is in the future"
          : mode === "assign" && onDate < asset.purchaseDate
            ? `This asset was bought on ${asset.purchaseDate}`
            : mode !== "assign" && asset.assignedOn && onDate < asset.assignedOn
              ? `It was issued on ${asset.assignedOn}`
              : null;

  const submit = async () => {
    if (error) return;
    setSaving(true);
    try {
      if (mode === "assign") {
        await rpcAssignAsset({
          assetId: asset.id,
          employeeId,
          department,
          assignedOn: onDate,
          receivedById: receivedById || null,
          remarks,
        });
        toast("Asset issued", "success");
      } else if (mode === "transfer") {
        await rpcTransferAsset({
          assetId: asset.id,
          employeeId,
          department,
          onDate,
          receivedById: receivedById || null,
          remarks,
        });
        toast("Asset transferred", "success");
      } else {
        await rpcReturnAsset({
          assetId: asset.id,
          returnedOn: onDate,
          returnRemarks: remarks,
          condition,
        });
        toast("Asset back in stock", "success");
      }
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record that", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={TITLES[mode]} onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-[11px] bg-cream px-3 py-2 text-xs text-ink">
          <strong>{asset.name}</strong> <span className="text-ink-muted">{asset.code}</span>
          {asset.assignedToName && (
            <>
              {" · currently with "}
              <strong>{asset.assignedToName}</strong>
            </>
          )}
        </p>

        {needsEmployee && (
          <div>
            <label className={labelCls} htmlFor="ag-emp">
              {mode === "transfer" ? "Transfer to" : "Issue to"}
            </label>
            <select
              id="ag-emp"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose…</option>
              {holders
                .filter((h) => mode !== "transfer" || h.id !== asset.assignedTo)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="ag-date">
              {mode === "return" ? "Returned on" : "Issued on"}
            </label>
            <input
              id="ag-date"
              type="date"
              max={today}
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={inputCls}
            />
          </div>
          {needsEmployee ? (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="ag-dept">Department (optional)</label>
              <input
                id="ag-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputCls}
              />
            </div>
          ) : (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="ag-cond">Condition back</label>
              <select
                id="ag-cond"
                value={condition}
                onChange={(e) => setCondition(e.target.value as AssetCondition)}
                className={inputCls}
              >
                <option value="">Leave as recorded</option>
                {ASSET_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {conditionLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {needsEmployee && (
          <div>
            <label className={labelCls} htmlFor="ag-recv">
              Handed over by someone else? (optional)
            </label>
            <select
              id="ag-recv"
              value={receivedById}
              onChange={(e) => setReceivedById(e.target.value)}
              className={inputCls}
            >
              <option value="">No — recorded by me</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelCls} htmlFor="ag-rem">Remarks (optional)</label>
          <input
            id="ag-rem"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className={inputCls}
          />
        </div>

        {mode === "transfer" && (
          <p className="rounded-[10px] bg-[#faf4ea] px-2.5 py-2 text-[11px] text-ink-muted">
            This closes the current custody record and opens a new one on the same
            date, so the trail stays continuous.
          </p>
        )}

        {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}

        <button
          disabled={!!error || saving}
          onClick={() => void submit()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {TITLES[mode]}
        </button>
      </div>
    </Modal>
  );
}
