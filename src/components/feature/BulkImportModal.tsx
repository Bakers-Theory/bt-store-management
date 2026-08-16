"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, FileUp, Loader2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { isoDateLocal } from "@/lib/excel";
import { hasPermission } from "@/lib/permissions";
import { useCurrentUser } from "@/components/system/AuthProvider";
import {
  consumableLinesFrom,
  emptyItemPurchaseDraft,
  itemPurchaseError,
  linesFrom,
  withoutOpeningQty,
  type OpeningConsumableStock,
  type OpeningStock,
} from "@/lib/item-purchase";
import { RecordAsPurchaseFields } from "@/components/feature/suppliers/RecordAsPurchaseFields";
import type { Supplier } from "@/lib/types";
import {
  ASSET_CSV_HEADERS,
  CONSUMABLE_CSV_HEADERS,
  ITEM_CSV_HEADERS,
  MOVEMENT_CSV_HEADERS,
  parseCsv,
  planAssetImport,
  planConsumableImport,
  planItemImport,
  planMovementImport,
  templateCsv,
  toRecords,
  type NamedRef,
  type RowError,
} from "@/lib/csv-import";
import {
  fetchAssetHolders,
  fetchSuppliers,
  rpcLinkSupplierItem,
  rpcPostItemPurchase,
  rpcRecordStockMovements,
  rpcSaveAsset,
  rpcSaveConsumable,
} from "@/lib/supabase-data";

export type ImportMode = "assets" | "consumables" | "movements" | "items";

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
      "Categories must already exist in Settings, and Vendor is a supplier's name " +
      "or code.",
  },
  consumables: {
    title: "Import consumables",
    headers: CONSUMABLE_CSV_HEADERS,
    template: "consumables-template.csv",
    blurb:
      "Name, Category, Unit and Minimum are required. Categories and units must " +
      "already exist in Settings. Bill mode is none, charge or absorb — charging " +
      "needs a cost per unit, and GST rate must be 0, 5, 12, 18 or 28. Vendor is " +
      "a supplier's name or code.",
  },
  items: {
    title: "Import products",
    headers: ITEM_CSV_HEADERS,
    template: "products-template.csv",
    blurb:
      "Name, Category and Unit are required — categories and units must already " +
      "exist in Settings. Everything else is optional: GST rate must be 0, 5, 12, " +
      "18 or 28, and Tracks expiry is yes or no.",
  },
  movements: {
    title: "Import stock movements",
    headers: MOVEMENT_CSV_HEADERS,
    template: "stock-movements-template.csv",
    blurb:
      "Item can be a code or a name. Type is purchase, issue, return, adjustment, " +
      "wastage, expired or damaged — the write-off types need a reason. Unit cost " +
      "and Vendor belong on a purchase, Issued to on an issue.",
  },
};

interface Outcome {
  imported: number;
  failures: RowError[];
  /** "items" mode: what became of the purchase, when one was being filed. */
  purchase?: { ok: boolean; message: string };
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
  onImported,
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
    /** "items" mode only: names already in Stock, which a row may not clash with. */
    existingItemNames?: string[];
    /**
     * "items" and "consumables" modes: when set, everything imported belongs to
     * this supplier — products are linked to it, consumables are filed under it
     * as their vendor — and the delivery can be recorded as a purchase from them.
     */
    linkToSupplier?: Supplier;
  };
  onClose: () => void;
  onDone: () => void;
  /**
   * "items" mode: when set, the modal does NOT file a purchase of its own. It
   * creates the products with no stock and hands their quantities back, for a
   * caller that is already building an invoice — the Purchases form, which posts
   * one invoice for the whole delivery rather than two for the same goods.
   */
  onImported?: (stock: OpeningStock[]) => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const saveItem = useBakeryStore((s) => s.saveItem);
  const reloadStore = useBakeryStore((s) => s.load);
  const user = useCurrentUser();
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = COPY[mode];
  const today = isoDateLocal(new Date());

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // A Vendor / Issued to cell names a supplier or a person, so those lists have
  // to be here to turn a name into an id. Fetched by the modal rather than asked
  // of every caller, which is also what the forms these mirror do. Until they
  // arrive a named vendor cannot be matched, so the Import button waits below.
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [holders, setHolders] = useState<NamedRef[] | null>(null);
  // A supplier-scoped import needs neither list: everything belongs to the one
  // supplier the caller passed, and only a movement can name a person.
  const needsVendors = mode !== "items" && !context.linkToSupplier;
  const needsHolders = mode === "movements";

  const canPurchase =
    hasPermission(user, "purchases.create") && hasPermission(user, "suppliers.view");
  // Off a supplier's page there is nobody to invoice until the operator says who
  // the delivery came from, so the Consumables import asks. Picking one also
  // makes them the vendor of every row — a file is one delivery.
  const [pickedSupplierId, setPickedSupplierId] = useState("");
  const purchaseSupplier =
    context.linkToSupplier ?? (suppliers ?? []).find((s) => s.id === pickedSupplierId);

  // The caller is filing the invoice itself, so the modal must not offer to file
  // a second one for the same goods.
  const handOff = mode === "items" && !!onImported;
  const offerPurchase =
    mode === "items" && !!purchaseSupplier && canPurchase && !handOff;
  // Consumables are bought on the same invoice a product is (migration 0072),
  // so this is the same offer with the same fields. Posting brings the stock in
  // as a purchase movement, which is the only way consumable stock exists.
  const offerConsumablePurchase =
    mode === "consumables" &&
    !!purchaseSupplier &&
    canPurchase &&
    hasPermission(user, "consumables.issue");
  const [purchase, setPurchase] = useState(() => emptyItemPurchaseDraft(today));
  const [purchaseErr, setPurchaseErr] = useState<string | null>(null);

  const vendors: NamedRef[] | null =
    suppliers === null ? null : suppliers.map((v) => ({ id: v.id, code: v.code, name: v.name }));

  useEffect(() => {
    let alive = true;
    if (needsVendors) {
      void fetchSuppliers()
        .then((s) => alive && setSuppliers(s))
        .catch(() => alive && setSuppliers([]));
    }
    if (needsHolders) {
      void fetchAssetHolders()
        .then((h) => alive && setHolders(h.map((p) => ({ id: p.id, code: "", name: p.name }))))
        .catch(() => alive && setHolders([]));
    }
    return () => {
      alive = false;
    };
  }, [needsVendors, needsHolders]);

  const refsReady =
    (!needsVendors || vendors !== null) && (!needsHolders || holders !== null);
  const parsed = text.trim() === "" || !refsReady ? null : toRecords(parseCsv(text));

  // Each mode's plan is built with its own row type rather than one union — the
  // import step below needs real types, not casts, to call the right RPC.
  const assetPlan =
    parsed && mode === "assets"
      ? planAssetImport(parsed, {
          categories: context.categories,
          vendors: vendors ?? [],
          today,
        })
      : null;
  const consumablePlan =
    parsed && mode === "consumables"
      ? planConsumableImport(parsed, {
          categories: context.categories,
          units: context.units ?? [],
          vendors: vendors ?? [],
          forceVendorId: purchaseSupplier?.id,
        })
      : null;
  const movementPlan =
    parsed && mode === "movements"
      ? planMovementImport(parsed, {
          items: context.items ?? [],
          vendors: vendors ?? [],
          holders: holders ?? [],
          today,
        })
      : null;
  const itemPlan =
    parsed && mode === "items"
      ? planItemImport(parsed, {
          categories: context.categories,
          units: context.units ?? [],
          existingNames: context.existingItemNames ?? [],
          today,
        })
      : null;

  const plan: { rowCount: number; errors: RowError[] } | null = !parsed
    ? null
    : parsed.records.length === 0
      ? { rowCount: 0, errors: [{ line: 1, message: "no rows below the header" }] }
      : (() => {
          const p = assetPlan ?? consumablePlan ?? movementPlan ?? itemPlan;
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
    // One invoice for the whole file: it is one delivery with one invoice number,
    // and (supplier_id, invoice_no) is unique (0037:76) — so re-running the same
    // file fails on the duplicate rather than posting the purchase twice.
    const posting =
      offerPurchase && !!purchaseSupplier && purchase.record && (itemPlan?.rows.length ?? 0) > 0;
    if (posting && purchaseSupplier) {
      const problem = itemPurchaseError(purchase, purchaseSupplier.supplierType, today);
      if (problem) {
        setPurchaseErr(problem);
        return;
      }
    }
    const receiving =
      offerConsumablePurchase &&
      !!purchaseSupplier &&
      purchase.record &&
      (consumablePlan?.rows.length ?? 0) > 0;
    if (receiving && purchaseSupplier) {
      const problem = itemPurchaseError(purchase, purchaseSupplier.supplierType, today);
      if (problem) {
        setPurchaseErr(problem);
        return;
      }
    }
    setPurchaseErr(null);
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
        // Filled by the item rows as they are created, so the invoice below can
        // reference products that did not exist when the file was read.
        const opening: OpeningStock[] = [];
        // The consumable equivalent: what each created consumable arrived with,
        // invoiced once every row has been saved.
        const received: OpeningConsumableStock[] = [];
        const supplierId = purchaseSupplier?.id;
        const rows: { line: number; run: () => Promise<unknown> }[] = assetPlan
          ? assetPlan.rows.map((r) => ({ line: r.line, run: () => rpcSaveAsset(r.value) }))
          : itemPlan
            ? itemPlan.rows.map((r) => ({
                line: r.line,
                // saveItem rather than the RPC directly, so the products appear in
                // Stock without a reload. The link is part of the row's work: a
                // product imported for a supplier and not linked to it is only
                // half of what was asked for, so a link failure fails the row —
                // and says the product was created, since it was.
                run: async () => {
                  const input = {
                    ...r.value,
                    // Any opening stock came from this supplier, so the batch says
                    // so rather than reading "Unknown source" (0071). When an
                    // invoice is posting, that invoice stamps the batch instead.
                    supplierId: supplierId ?? null,
                  };
                  const saved = await saveItem(
                    posting || handOff ? withoutOpeningQty(input) : input,
                  );
                  if (!saved.itemId) return;
                  if (posting || handOff) {
                    opening.push({
                      itemId: saved.itemId,
                      qty: r.value.qty,
                      costPrice: r.value.costPrice,
                      gstRate: r.value.gstRate,
                      expiryDate: r.value.expiryDate,
                    });
                  }
                  if (!supplierId) return;
                  try {
                    await rpcLinkSupplierItem(supplierId, saved.itemId);
                  } catch {
                    throw new Error(
                      `"${r.value.name}" was created but could not be linked to this supplier`,
                    );
                  }
                },
              }))
            : (consumablePlan?.rows ?? []).map((r) => ({
                line: r.line,
                run: async () => {
                  const id = await rpcSaveConsumable(r.value);
                  if (receiving && id && r.value.openingQty > 0) {
                    received.push({
                      consumableId: id,
                      qty: r.value.openingQty,
                      costPerUnit: r.value.costPerUnit,
                      gstRate: r.value.gstRate,
                    });
                  }
                },
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

        // The invoice goes in last, covering every product that actually made it
        // in — a row the server refused has nothing to invoice. Its stock arrives
        // with the posting, so a failure here means those products exist with no
        // stock, which is what the message has to say.
        let purchase_: Outcome["purchase"];
        if (posting && purchaseSupplier) {
          const lines = linesFrom(opening);
          if (lines.length === 0) {
            purchase_ = {
              ok: false,
              message: "No purchase was filed — none of the imported products had a quantity.",
            };
          } else {
            try {
              const inv = await rpcPostItemPurchase({
                supplierId: purchaseSupplier.id,
                invoiceNo: purchase.invoiceNo.trim(),
                purchaseDate: purchase.purchaseDate,
                notes: "",
                lines,
              });
              // Posting set cost_price and brought every batch in, so the cached
              // items are now behind the server.
              await reloadStore();
              purchase_ = {
                ok: true,
                message: `Filed ${inv.internalRef ?? inv.invoiceNo} against ${purchaseSupplier.name} — ${lines.length} line${lines.length === 1 ? "" : "s"}, stock included.`,
              };
            } catch (e) {
              purchase_ = {
                ok: false,
                message:
                  (e instanceof Error ? e.message : "the server refused the invoice") +
                  ` — the ${lines.length} product${lines.length === 1 ? " was" : "s were"} created, but with no stock, since the invoice is what brings it in. File it on the Purchases page.`,
              };
            }
          }
        }
        // Nothing is filed here — the caller's invoice is the one that will bring
        // this stock in, so the quantities go back to it as lines.
        if (handOff && onImported) {
          onImported(opening);
          const withQty = opening.filter((o) => o.qty > 0).length;
          const without = opening.length - withQty;
          // A row with no quantity makes no line (qty > 0 is a table constraint),
          // so it is called out rather than quietly dropped.
          const skipped = without
            ? ` ${without} row${without === 1 ? " had" : "s had"} no quantity, so ${without === 1 ? "it is" : "they are"} only in Stock — add ${without === 1 ? "it" : "them"} by hand if ${without === 1 ? "it" : "they"} arrived.`
            : "";
          purchase_ = {
            ok: true,
            message:
              withQty === 0
                ? `No lines were added — none of the rows had a quantity. The ${opening.length} product${opening.length === 1 ? " is" : "s are"} in Stock.`
                : `Added ${withQty} line${withQty === 1 ? "" : "s"} to the purchase. Nothing is filed and no stock has moved until you post it.${skipped}`,
          };
        }

        // One invoice for the consumables too, exactly as above: posting it is
        // what puts the stock on the shelf, and it is the payable the supplier's
        // Transactions tab and Account summary read.
        if (receiving && purchaseSupplier) {
          const lines = consumableLinesFrom(received);
          if (lines.length === 0) {
            purchase_ = {
              ok: false,
              message:
                "No purchase was filed — none of the imported consumables had an opening quantity.",
            };
          } else {
            try {
              const inv = await rpcPostItemPurchase({
                supplierId: purchaseSupplier.id,
                invoiceNo: purchase.invoiceNo.trim(),
                purchaseDate: purchase.purchaseDate,
                notes: "",
                lines,
              });
              purchase_ = {
                ok: true,
                message: `Filed ${inv.internalRef ?? inv.invoiceNo} against ${purchaseSupplier.name} — ${lines.length} line${lines.length === 1 ? "" : "s"}, stock included.`,
              };
            } catch (e) {
              purchase_ = {
                ok: false,
                message:
                  (e instanceof Error ? e.message : "the server refused the invoice") +
                  ` — the ${lines.length} consumable${lines.length === 1 ? " was" : "s were"} created, but with no stock, since the invoice is what brings it in. File it on the Purchases page.`,
              };
            }
          }
        }

        setOutcome({ imported, failures, purchase: purchase_ });
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
          {mode === "consumables" &&
            (purchaseSupplier
              ? ` Every row is filed under ${purchaseSupplier.name}, so the Vendor column is ignored. Opening qty is what arrived, and goes on the invoice below.`
              : " Opening qty only counts once you name who the delivery came from below — without that there is nothing to file it against.")}
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

        {/* The Consumables page has no supplier of its own, so filing the
            delivery as a purchase starts by naming who it came from. */}
        {mode === "consumables" &&
          !context.linkToSupplier &&
          canPurchase &&
          hasPermission(user, "consumables.issue") &&
          !outcome && (
            <div>
              <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]" htmlFor="bi-from">
                Bought from (optional)
              </label>
              <select
                id="bi-from"
                value={pickedSupplierId}
                disabled={busy}
                onChange={(e) => {
                  setPickedSupplierId(e.target.value);
                  setPurchaseErr(null);
                }}
                className="w-full rounded-[11px] border border-line bg-warm-white px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-brown"
              >
                <option value="">Not a delivery — just set these items up</option>
                {(suppliers ?? [])
                  .filter((s) => s.status === "active")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.code}
                    </option>
                  ))}
              </select>
            </div>
          )}

        {(offerPurchase || offerConsumablePurchase) && purchaseSupplier && !outcome && (
          <RecordAsPurchaseFields
            supplier={purchaseSupplier}
            draft={purchase}
            onChange={(next) => {
              setPurchase(next);
              setPurchaseErr(null);
            }}
            error={purchaseErr}
            disabled={busy}
          />
        )}

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
            {outcome.purchase && (
              <p
                className={`rounded-[11px] px-2.5 py-2 text-[11.5px] ${
                  outcome.purchase.ok ? "bg-cream text-ink" : "bg-red-50 text-red-800"
                }`}
              >
                {outcome.purchase.message}
              </p>
            )}
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

        {text.trim() !== "" && !refsReady && (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
            <Loader2 size={13} className="animate-spin" /> Loading the supplier list…
          </p>
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
