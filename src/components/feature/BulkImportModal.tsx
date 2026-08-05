"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, Download, FileUp, Loader2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { isoDateLocal } from "@/lib/excel";
import {
  ASSET_CSV_HEADERS,
  CONSUMABLE_CSV_HEADERS,
  MOVEMENT_CSV_HEADERS,
  parseCsv,
  planAssetImport,
  planConsumableImport,
  planMovementImport,
  templateCsv,
  toRecords,
  type RowError,
} from "@/lib/csv-import";
import {
  rpcRecordStockMovements,
  rpcSaveAsset,
  rpcSaveConsumable,
} from "@/lib/supabase-data";

export type ImportMode = "assets" | "consumables" | "movements";

const COPY: Record<
  ImportMode,
  { title: string; headers: string[]; template: string; blurb: string }
> = {
  assets: {
    title: "Import assets",
    headers: ASSET_CSV_HEADERS,
    template: "assets-template.csv",
    blurb:
      "Name, Category, Location, Purchase date and Purchase price are required. " +
      "Categories must already exist in Settings.",
  },
  consumables: {
    title: "Import consumables",
    headers: CONSUMABLE_CSV_HEADERS,
    template: "consumables-template.csv",
    blurb:
      "Name, Category, Unit and Minimum are required. Categories and units must " +
      "already exist in Settings.",
  },
  movements: {
    title: "Import stock movements",
    headers: MOVEMENT_CSV_HEADERS,
    template: "stock-movements-template.csv",
    blurb:
      "Item can be a code or a name. Type is purchase, issue, return, adjustment, " +
      "wastage, expired or damaged — the write-off types need a reason.",
  },
};

interface Outcome {
  imported: number;
  failures: RowError[];
}

/**
 * CSV bulk import (#91 §7), one modal for all three shapes.
 *
 * Three decisions worth knowing:
 *
 *  - **Nothing is imported until the whole file reads cleanly.** A file with any
 *    unreadable row is shown with its line numbers and the Import button stays
 *    disabled. Half-importing a spreadsheet leaves someone reconciling two lists.
 *  - **Assets and consumables are imported row by row**, because each is an
 *    independent record and a server-side rejection on row 40 should not undo the
 *    39 that were fine. Those rejections are reported with their line numbers.
 *  - **Movements go in one atomic call** (`record_stock_movements`), because they
 *    interact: rows 2 and 3 can depend on the stock row 1 brought in, so a
 *    partial application would leave the ledger in a state the file never
 *    described.
 */
export function BulkImportModal({
  mode,
  context,
  onClose,
  onDone,
}: {
  mode: ImportMode;
  context: {
    categories: string[];
    units?: string[];
    items?: {
      id: string;
      code: string;
      name: string;
      unit: string;
      currentStock: number;
    }[];
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = COPY[mode];
  const today = isoDateLocal(new Date());

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const parsed = text.trim() === "" ? null : toRecords(parseCsv(text));

  // Each mode's plan is built with its own row type rather than one union — the
  // import step below needs real types, not casts, to call the right RPC.
  const assetPlan =
    parsed && mode === "assets"
      ? planAssetImport(parsed, { categories: context.categories, today })
      : null;
  const consumablePlan =
    parsed && mode === "consumables"
      ? planConsumableImport(parsed, {
          categories: context.categories,
          units: context.units ?? [],
        })
      : null;
  const movementPlan =
    parsed && mode === "movements"
      ? planMovementImport(parsed, { items: context.items ?? [], today })
      : null;

  const plan: { rowCount: number; errors: RowError[] } | null = !parsed
    ? null
    : parsed.records.length === 0
      ? { rowCount: 0, errors: [{ line: 1, message: "no rows below the header" }] }
      : (() => {
          const p = assetPlan ?? consumablePlan ?? movementPlan;
          return { rowCount: p?.rows.length ?? 0, errors: p?.errors ?? [] };
        })();

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setOutcome(null);
    setText(await file.text());
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(
      new Blob([templateCsv(copy.headers)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = copy.template;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    if (!plan || plan.errors.length > 0 || plan.rowCount === 0) return;
    setBusy(true);
    setOutcome(null);
    try {
      if (movementPlan) {
        // One atomic call: these rows interact, so all or nothing.
        await rpcRecordStockMovements(movementPlan.rows.map((r) => r.value));
        setOutcome({ imported: movementPlan.rows.length, failures: [] });
      } else {
        // Row by row: each record is independent, so a rejection on row 40 must
        // not undo the 39 that were fine. Every rejection is reported with its
        // line number.
        const failures: RowError[] = [];
        let imported = 0;
        const rows: { line: number; run: () => Promise<unknown> }[] = assetPlan
          ? assetPlan.rows.map((r) => ({ line: r.line, run: () => rpcSaveAsset(r.value) }))
          : (consumablePlan?.rows ?? []).map((r) => ({
              line: r.line,
              run: () => rpcSaveConsumable(r.value),
            }));

        for (const row of rows) {
          try {
            await row.run();
            imported++;
          } catch (e) {
            failures.push({
              line: row.line,
              message: e instanceof Error ? e.message : "the server refused this row",
            });
          }
        }
        setOutcome({ imported, failures });
      }
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "The import failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={copy.title} onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-[11px] bg-cream px-3 py-2 text-[11.5px] text-ink">
          {copy.blurb}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-bold text-ink"
          >
            <Download size={13} /> Template
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-bold text-ink"
          >
            <FileUp size={13} /> Choose CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={pickFile} />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]" htmlFor="bi-text">
            …or paste the rows
          </label>
          <textarea
            id="bi-text"
            value={text}
            onChange={(e) => {
              setOutcome(null);
              setText(e.target.value);
            }}
            rows={5}
            placeholder={copy.headers.join(",")}
            className="w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 font-mono text-[12px] text-ink"
          />
        </div>

        {plan && !outcome && (
          <div className="space-y-2">
            <p className="text-[12.5px] font-bold text-ink">
              {plan.rowCount} row{plan.rowCount === 1 ? "" : "s"} ready
              {plan.errors.length > 0 && (
                <span className="text-red-700">
                  {" · "}
                  {plan.errors.length} to fix
                </span>
              )}
            </p>

            {plan.errors.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-[11px] bg-red-50 p-2.5">
                {plan.errors.map((e) => (
                  <p key={`${e.line}-${e.message}`} className="text-[11.5px] text-red-800">
                    <strong>Line {e.line}:</strong> {e.message}
                  </p>
                ))}
              </div>
            )}

            {plan.errors.length > 0 && (
              <p className="flex gap-1.5 rounded-[10px] bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                <span>
                  Nothing is imported while any row has a problem — fix the file and
                  choose it again, so you never end up reconciling two lists.
                </span>
              </p>
            )}
          </div>
        )}

        {outcome && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Check size={14} className="text-success" />
              {outcome.imported} imported
            </p>
            {outcome.failures.length > 0 && (
              <>
                <p className="text-[12px] font-bold text-red-700">
                  {outcome.failures.length} refused by the server
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-[11px] bg-red-50 p-2.5">
                  {outcome.failures.map((f) => (
                    <p key={f.line} className="text-[11.5px] text-red-800">
                      <strong>Line {f.line}:</strong> {f.message}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={busy || !plan || plan.errors.length > 0 || plan.rowCount === 0 || !!outcome}
          onClick={() => void runImport()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {outcome
            ? "Done"
            : plan && plan.rowCount > 0
              ? `Import ${plan.rowCount} row${plan.rowCount === 1 ? "" : "s"}`
              : "Import"}
        </button>

        {mode === "movements" && (
          <p className="text-center text-[11px] text-ink-muted">
            Recorded in one go — if any row fails, none of them are saved.
          </p>
        )}
      </div>
    </Modal>
  );
}
