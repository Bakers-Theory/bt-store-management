"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { rpcAssignAsset } from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { Asset, Employee } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

/**
 * Bulk assignment (#91 §7) — one employee, several assets, one date.
 *
 * Issued one call at a time rather than in a single transaction, because each
 * assignment is an independent custody record: if the fourth asset turns out to be
 * archived, the three already issued are correctly issued and should stay that
 * way. Failures are listed by asset code so the operator knows exactly what to
 * chase, which is why this does not use a bulk RPC.
 */
export function BulkAssignModal({
  assets,
  holders,
  onClose,
  onDone,
}: {
  /** Only assets that can actually be issued — the caller filters. */
  assets: Asset[];
  holders: Employee[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());

  const [employeeId, setEmployeeId] = useState("");
  const [onDate, setOnDate] = useState(today);
  const [department, setDepartment] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<{ code: string; message: string }[]>([]);

  // An asset bought after the issue date cannot be issued on it, and the server
  // says so per asset — catch it here so the whole batch is not part-applied.
  const tooEarly = assets.filter((a) => a.purchaseDate > onDate);

  const error =
    employeeId === ""
      ? "Choose who these are going to"
      : onDate > today
        ? "That date is in the future"
        : tooEarly.length > 0
          ? `${tooEarly[0].code} was bought on ${tooEarly[0].purchaseDate}`
          : null;

  const submit = async () => {
    if (error) return;
    setBusy(true);
    setFailures([]);
    const failed: { code: string; message: string }[] = [];
    let done = 0;
    for (const a of assets) {
      try {
        await rpcAssignAsset({
          assetId: a.id,
          employeeId,
          department: department || a.department,
          assignedOn: onDate,
          remarks,
        });
        done++;
      } catch (e) {
        failed.push({
          code: a.code,
          message: e instanceof Error ? e.message : "could not be issued",
        });
      }
    }
    setBusy(false);
    setFailures(failed);
    if (done > 0) {
      toast(`${done} asset${done === 1 ? "" : "s"} issued`, failed.length ? "info" : "success");
    }
    onDone();
    // Only close when everything landed; otherwise the list of failures is the
    // whole point of the screen.
    if (failed.length === 0) onClose();
  };

  const holder = holders.find((h) => h.id === employeeId);

  return (
    <Modal title={`Issue ${assets.length} asset${assets.length === 1 ? "" : "s"}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="max-h-32 space-y-1 overflow-y-auto rounded-[11px] bg-cream px-3 py-2">
          {assets.map((a) => (
            <p key={a.id} className="truncate text-[12px] text-ink">
              <span className="font-bold">{a.code}</span> {a.name}
            </p>
          ))}
        </div>

        <div>
          <label className={labelCls} htmlFor="ba-emp">Issue to</label>
          <select
            id="ba-emp"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={inputCls}
          >
            <option value="">Choose…</option>
            {holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label className={labelCls} htmlFor="ba-date">Issued on</label>
            <input
              id="ba-date"
              type="date"
              max={today}
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="ba-dept">Department (optional)</label>
            <input
              id="ba-dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Each asset's own"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="ba-rem">Remarks (optional)</label>
          <input
            id="ba-rem"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className={inputCls}
          />
        </div>

        {failures.length > 0 && (
          <div className="space-y-1 rounded-[11px] bg-red-50 p-2.5">
            <p className="text-[12px] font-bold text-red-800">
              {failures.length} could not be issued
            </p>
            {failures.map((f) => (
              <p key={f.code} className="text-[11.5px] text-red-800">
                <strong>{f.code}:</strong> {f.message}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}

        <button
          disabled={!!error || busy}
          onClick={() => void submit()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Issue to {holder?.name ?? "…"}
        </button>
        <p className="text-center text-[11px] text-ink-muted">
          Each asset gets its own custody record, so one failure does not undo the
          rest.
        </p>
      </div>
    </Modal>
  );
}
