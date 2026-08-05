"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { rpcSetAssetStatus } from "@/lib/supabase-data";
import { isoDateLocal } from "@/lib/excel";
import type { Asset } from "@/lib/types";

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";
const inputCls =
  "w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-sm text-ink";

export type StatusTarget = "lost" | "damaged" | "retired" | "available";

const COPY: Record<StatusTarget, { title: string; verb: string; blurb: string }> = {
  lost: {
    title: "Report as lost",
    verb: "Mark lost",
    blurb:
      "Lost is final — the record stays for audit and reports, but the asset cannot come back.",
  },
  damaged: {
    title: "Report as damaged",
    verb: "Mark damaged",
    blurb: "A damaged asset can still be repaired or retired later.",
  },
  retired: {
    title: "Retire asset",
    verb: "Retire it",
    blurb:
      "Retiring is final. Nothing is deleted — it stays in reports and in its own history.",
  },
  available: {
    title: "Back in service",
    verb: "Mark available",
    blurb: "It becomes available to issue again.",
  },
};

/**
 * The §2.4 "mark" actions. A reason is required for lost and damaged, because
 * those are the two that need explaining later — `set_asset_status` insists on it
 * too, so this is not the only guard.
 */
export function StatusModal({
  asset,
  target,
  onClose,
  onDone,
}: {
  asset: Asset;
  target: StatusTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const today = isoDateLocal(new Date());
  const copy = COPY[target];
  const reasonRequired = target === "lost" || target === "damaged";

  const [note, setNote] = useState("");
  const [onDate, setOnDate] = useState(today);
  const [saving, setSaving] = useState(false);

  const error =
    reasonRequired && note.trim() === ""
      ? "Say what happened"
      : onDate > today
        ? "That date is in the future"
        : null;

  const submit = async () => {
    if (error) return;
    setSaving(true);
    try {
      await rpcSetAssetStatus(asset.id, target, note.trim(), onDate);
      toast(`${asset.code} — ${copy.verb.toLowerCase()}`, "success");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update the asset", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={copy.title} onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-[11px] bg-cream px-3 py-2 text-xs text-ink">
          <strong>{asset.name}</strong> <span className="text-ink-muted">{asset.code}</span>
          {asset.status === "assigned" && asset.assignedToName && (
            <span className="block text-ink-muted">
              This also takes it back from {asset.assignedToName}.
            </span>
          )}
        </p>

        <div>
          <label className={labelCls} htmlFor="st-date">On</label>
          <input
            id="st-date"
            type="date"
            max={today}
            value={onDate}
            onChange={(e) => setOnDate(e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="st-note">
            {reasonRequired ? "What happened" : "Note (optional)"}
          </label>
          <input
            id="st-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputCls}
          />
        </div>

        <p className="rounded-[10px] bg-[#faf4ea] px-2.5 py-2 text-[11px] text-ink-muted">
          {copy.blurb}
        </p>

        {error && note !== "" && (
          <p className="text-[11px] font-semibold text-red-700">{error}</p>
        )}

        <button
          disabled={!!error || saving}
          onClick={() => void submit()}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-[13px] py-3 text-sm font-bold text-white disabled:opacity-50 ${
            target === "available" ? "bg-brown" : "bg-red-700"
          }`}
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {copy.verb}
        </button>
      </div>
    </Modal>
  );
}
