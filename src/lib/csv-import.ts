/**
 * CSV import for assets, consumables and stock movements (#91 §7's bulk import).
 *
 * Pure: parsing and validation happen here and are unit-tested, so the modal that
 * drives them only has to render a preview and call the RPCs. Three rules shape
 * the design:
 *
 *   1. NOTHING IS GUESSED. A row that cannot be read is REPORTED, never silently
 *      dropped or coerced — an import that quietly skipped three rows is worse
 *      than one that refused them, because nobody goes looking.
 *   2. THE VALIDATION IS THE SAME VALIDATION. These checks mirror `asset.ts` /
 *      `consumable.ts` and, behind them, the RPCs. The server still re-checks
 *      every row; this exists so 200 bad rows fail in the browser rather than as
 *      200 round trips.
 *   3. CATEGORIES AND UNITS MUST ALREADY EXIST. Both come from the admin-managed
 *      lists, and an import is not the place to invent one — a typo would create
 *      "Packging" forever.
 */
import type {
  AssetCondition,
  AssetInput,
  BillMode,
  ConsumableInput,
  MovementType,
} from "./types";
import type { ItemInput } from "./store";
import { BILL_MODES, MOVEMENT_TYPES, reasonRequired } from "./consumable";
import { ASSET_CONDITIONS } from "./asset";
import { GST_RATES } from "./constants";

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * A small RFC 4180 reader: quoted fields, escaped quotes (`""`), and newlines
 * inside quotes. Enough for a spreadsheet export, which is the only source this
 * needs to read.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Strip a BOM: Excel writes one, and it would otherwise corrupt the first header.
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // Swallow: the \n that follows ends the row.
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing newline yields one empty row; blank lines mid-file are noise too.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Header keys are matched loosely: case, spaces and punctuation are ignored. */
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface CsvRecord {
  /** 1-based line in the file, header included — what an error message cites. */
  line: number;
  get: (...aliases: string[]) => string;
}

export interface ParsedCsv {
  headers: string[];
  records: CsvRecord[];
}

/** Rows keyed by header, with the file line each came from. */
export function toRecords(rows: string[][]): ParsedCsv {
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normalise(h);
    // First column wins on a duplicate header, so a stray repeat cannot shadow it.
    if (key && !index.has(key)) index.set(key, i);
  });

  const records = rows.slice(1).map((cells, n) => ({
    line: n + 2,
    get: (...aliases: string[]) => {
      for (const a of aliases) {
        const i = index.get(normalise(a));
        if (i !== undefined && cells[i] !== undefined) return cells[i].trim();
      }
      return "";
    },
  }));

  return { headers, records };
}

// ─── Shared cell readers ────────────────────────────────────────────────────

export interface RowError {
  line: number;
  message: string;
}

export interface ImportPlan<T> {
  rows: { line: number; value: T }[];
  errors: RowError[];
}

/**
 * Accepts `YYYY-MM-DD` (what a machine writes) as well as `DD-MM-YYYY` and
 * `DD/MM/YYYY` (what a person writes, and what this app's own exports produce).
 * Returns null on anything else rather than a Date that silently means January.
 */
export function parseDateCell(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return isRealDate(iso[1], iso[2], iso[3]) ? v : null;
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(v);
  if (dmy) {
    const [, d, m, y] = dmy;
    const p = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isRealDate(y, m, d) ? p : null;
  }
  return null;
}

function isRealDate(y: string, m: string, d: string): boolean {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return false;
  // Month lengths, leap years included — "31-02-2026" is not a date.
  const lengths = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
                   31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1];
}

/** A number, or null when the cell is blank. Rejects anything unparseable. */
export function parseNumberCell(raw: string): number | null | "invalid" {
  const v = raw.trim().replace(/,/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : "invalid";
}

/**
 * Something a row names instead of picking from a dropdown — a supplier, or the
 * person stock was issued to. Both forms are on screen in the app, so both are
 * accepted: the code someone would quote off a bill, or the name they know.
 * `code` is empty for records that have none, such as employees.
 */
export interface NamedRef {
  id: string;
  code: string;
  name: string;
}

const refIndex = (refs: NamedRef[]): Map<string, NamedRef> => {
  const byKey = new Map<string, NamedRef>();
  for (const v of refs) {
    // Codes go in first: a code is unique, so it must not be shadowed by a name
    // that happens to normalise to the same string.
    if (v.code) byKey.set(normalise(v.code), v);
  }
  for (const v of refs) {
    const key = normalise(v.name);
    if (key && !byKey.has(key)) byKey.set(key, v);
  }
  return byKey;
};

/**
 * Resolves such a cell to an id. Blank means "not recorded", which is what these
 * dropdowns default to; a value that matches nothing is REFUSED rather than
 * dropped, because a silently unlinked supplier looks identical to one that was
 * never entered.
 */
function resolveRefCell(raw: string, index: Map<string, NamedRef>): string | null | "unknown" {
  const v = raw.trim();
  if (v === "") return null;
  return index.get(normalise(v))?.id ?? "unknown";
}

// ─── Assets ─────────────────────────────────────────────────────────────────

export const ASSET_CSV_HEADERS = [
  "Name", "Category", "Brand", "Model", "Serial", "Purchase date",
  "Purchase price", "Vendor", "Location", "Department", "Condition",
  "Warranty start", "Warranty expiry", "Notes",
];

export interface AssetImportContext {
  categories: string[];
  /** Every supplier, so a row can name the one it was bought from. */
  vendors: NamedRef[];
  /** Store-calendar today, so a future purchase date is caught before the RPC. */
  today: string;
}

export function planAssetImport(
  parsed: ParsedCsv,
  ctx: AssetImportContext,
): ImportPlan<AssetInput> {
  const rows: { line: number; value: AssetInput }[] = [];
  const errors: RowError[] = [];
  // A duplicate serial inside the file itself would pass row-by-row validation
  // and then fail on the second insert, so it is caught here.
  const seenSerials = new Set<string>();
  const vendors = refIndex(ctx.vendors);

  for (const r of parsed.records) {
    const fail = (message: string) => errors.push({ line: r.line, message });

    const name = r.get("name", "asset", "asset name");
    const category = r.get("category", "asset category");
    const location = r.get("location", "kept at");
    const serial = r.get("serial", "serial number", "serialno");
    const price = parseNumberCell(r.get("purchase price", "price", "cost"));
    const bought = parseDateCell(r.get("purchase date", "bought", "bought on"));
    const wStart = parseDateCell(r.get("warranty start", "warranty from"));
    const wEnd = parseDateCell(r.get("warranty expiry", "warranty until", "warranty end"));
    const conditionRaw = r.get("condition").toLowerCase();
    const vendorRaw = r.get("vendor", "supplier", "bought from");
    const vendorId = resolveRefCell(vendorRaw, vendors);

    if (name === "") {
      fail("no name");
      continue;
    }
    if (!ctx.categories.includes(category)) {
      fail(
        category === ""
          ? "no category"
          : `category "${category}" does not exist — add it in Settings first`,
      );
      continue;
    }
    if (location === "") {
      fail("no location");
      continue;
    }
    if (bought === null) {
      fail(
        r.get("purchase date", "bought", "bought on") === ""
          ? "no purchase date"
          : "purchase date is not a date (use YYYY-MM-DD or DD-MM-YYYY)",
      );
      continue;
    }
    if (bought > ctx.today) {
      fail("purchase date is in the future");
      continue;
    }
    if (price === "invalid" || price === null) {
      fail(price === null ? "no purchase price" : "purchase price is not a number");
      continue;
    }
    if (price < 0) {
      fail("purchase price is negative");
      continue;
    }
    if (conditionRaw !== "" && !ASSET_CONDITIONS.includes(conditionRaw as never)) {
      fail(`condition "${conditionRaw}" is not one of new, good, fair, poor`);
      continue;
    }
    if (vendorId === "unknown") {
      fail(`no supplier matches "${vendorRaw}" — use its name or code, e.g. SUP-0001`);
      continue;
    }
    if (r.get("warranty expiry", "warranty until", "warranty end") !== "" && wEnd === null) {
      fail("warranty expiry is not a date");
      continue;
    }
    if (wStart !== null && wEnd !== null && wEnd < wStart) {
      fail("warranty ends before it starts");
      continue;
    }
    if (wEnd !== null && wEnd < bought) {
      fail("warranty ends before the asset was bought");
      continue;
    }
    if (serial !== "") {
      const key = serial.toLowerCase();
      if (seenSerials.has(key)) {
        fail(`serial "${serial}" appears twice in this file`);
        continue;
      }
      seenSerials.add(key);
    }

    rows.push({
      line: r.line,
      value: {
        name,
        category,
        brand: r.get("brand"),
        model: r.get("model"),
        serialNumber: serial,
        purchaseDate: bought,
        purchasePrice: price,
        vendorId,
        warrantyStart: wStart,
        warrantyExpiry: wEnd,
        location,
        department: r.get("department"),
        condition: (conditionRaw as AssetCondition) || "",
        notes: r.get("notes", "remarks"),
        imageUrl: null,
        documents: [],
      },
    });
  }

  return { rows, errors };
}

// ─── Consumables ────────────────────────────────────────────────────────────

export const CONSUMABLE_CSV_HEADERS = [
  "Name", "Category", "Unit", "Minimum", "Maximum", "Reorder level",
  "Reorder qty", "Cost per unit", "Bill mode", "HSN", "GST rate",
  "Vendor", "Expiry", "Storage", "Notes",
];

export interface ConsumableImportContext {
  categories: string[];
  units: string[];
  /** Every supplier, so a row can name the one it is usually bought from. */
  vendors: NamedRef[];
}

export function planConsumableImport(
  parsed: ParsedCsv,
  ctx: ConsumableImportContext,
): ImportPlan<ConsumableInput> {
  const rows: { line: number; value: ConsumableInput }[] = [];
  const errors: RowError[] = [];
  // The table's uniqueness is (name, unit), so the file is checked on that pair.
  const seen = new Set<string>();
  const vendors = refIndex(ctx.vendors);

  for (const r of parsed.records) {
    const fail = (message: string) => errors.push({ line: r.line, message });

    const name = r.get("name", "item", "item name");
    const category = r.get("category");
    const unit = r.get("unit", "counted in", "uom");
    const min = parseNumberCell(r.get("minimum", "min stock", "min"));
    const max = parseNumberCell(r.get("maximum", "max stock", "max"));
    const reorder = parseNumberCell(r.get("reorder level", "reorder at"));
    const rqty = parseNumberCell(r.get("reorder qty", "reorder quantity", "order qty"));
    const cost = parseNumberCell(r.get("cost per unit", "cost", "unit cost"));
    const expiryRaw = r.get("expiry", "expires", "expiry date");
    const expiry = parseDateCell(expiryRaw);
    const billRaw = r.get("bill mode", "billing", "at the billing counter").toLowerCase();
    const hsn = r.get("hsn", "hsn code", "sac", "hsnsac");
    const gstRaw = r.get("gst rate", "gst", "gst%", "tax rate");
    const gst = parseNumberCell(gstRaw);
    const vendorRaw = r.get("vendor", "supplier", "usually bought from", "bought from");
    const vendorId = resolveRefCell(vendorRaw, vendors);

    if (name === "") {
      fail("no name");
      continue;
    }
    if (!ctx.categories.includes(category)) {
      fail(
        category === ""
          ? "no category"
          : `category "${category}" does not exist — add it in Settings first`,
      );
      continue;
    }
    if (!ctx.units.includes(unit)) {
      fail(unit === "" ? "no unit" : `unit "${unit}" is not on the units list`);
      continue;
    }
    if (min === "invalid" || max === "invalid" || reorder === "invalid" ||
        rqty === "invalid" || cost === "invalid") {
      fail("a numeric column is not a number");
      continue;
    }
    if (min === null) {
      fail("no minimum stock — it is what triggers the low-stock alert");
      continue;
    }
    if (min < 0) {
      fail("minimum stock is negative");
      continue;
    }
    if (max !== null && max < min) {
      fail("maximum is below the minimum");
      continue;
    }
    if (reorder !== null && max !== null && reorder > max) {
      fail("reorder level is above the maximum");
      continue;
    }
    if (rqty !== null && rqty <= 0) {
      fail("reorder quantity must be more than zero");
      continue;
    }
    if (cost !== null && cost < 0) {
      fail("cost per unit is negative");
      continue;
    }
    if (expiryRaw !== "" && expiry === null) {
      fail("expiry is not a date");
      continue;
    }
    if (billRaw !== "" && !BILL_MODES.includes(billRaw as BillMode)) {
      fail(`bill mode "${billRaw}" is not one of ${BILL_MODES.join(", ")}`);
      continue;
    }
    const billMode = (billRaw as BillMode) || "none";
    // Mirrors the form and save_consumable (0067): a charged line is priced from
    // the cost, so charging without one puts a zero-value line on a bill.
    if (billMode === "charge" && !((cost ?? 0) > 0)) {
      fail(`set a cost per ${unit} before charging this item on a bill`);
      continue;
    }
    if (gst === "invalid" || (gst !== null && !GST_RATES.includes(gst as never))) {
      fail(`GST rate must be one of ${GST_RATES.join(", ")}`);
      continue;
    }
    if (vendorId === "unknown") {
      fail(`no supplier matches "${vendorRaw}" — use its name or code, e.g. SUP-0001`);
      continue;
    }

    const key = `${name.toLowerCase()}|${unit}`;
    if (seen.has(key)) {
      fail(`"${name} (${unit})" appears twice in this file`);
      continue;
    }
    seen.add(key);

    rows.push({
      line: r.line,
      value: {
        name,
        category,
        unit,
        vendorId,
        billMode,
        hsn,
        gstRate: gst ?? 0,
        minStock: min,
        maxStock: max,
        reorderLevel: reorder,
        reorderQty: rqty,
        costPerUnit: cost,
        expiryDate: expiry,
        storageLocation: r.get("storage", "storage location", "kept at"),
        notes: r.get("notes", "remarks"),
      },
    });
  }

  return { rows, errors };
}

// ─── Stock items (products) ─────────────────────────────────────────────────

export const ITEM_CSV_HEADERS = [
  "Name", "Category", "Unit", "Cost price", "Sell price", "Opening qty",
  "HSN", "GST rate", "Tracks expiry", "Expiry date", "Emoji",
];

export interface ItemImportContext {
  categories: string[];
  units: string[];
  /** Names already in Stock, so a row that would merge is flagged, not silently folded in. */
  existingNames: string[];
  /** Store-calendar today, so an expiry already in the past is caught before the RPC. */
  today: string;
}

/**
 * A yes/no cell. Blank means "not stated", which the caller turns into the same
 * default the Add Item form uses; anything unrecognised is refused rather than
 * read as false — "N/A" is not a no.
 */
function parseBoolCell(raw: string): boolean | null | "invalid" {
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (["yes", "y", "true", "1"].includes(v)) return true;
  if (["no", "n", "false", "0"].includes(v)) return false;
  return "invalid";
}

/**
 * Every field the Add Item form offers, minus the product image — a picture has
 * no CSV representation, so imported items keep their emoji and get an image
 * later in Stock.
 *
 * `create_item` merges a row whose name already exists into that item's stock.
 * That is right for a single deliberate save and wrong for a file, where it
 * would look like an import that lost products, so a clashing name is an error
 * here instead.
 */
export function planItemImport(
  parsed: ParsedCsv,
  ctx: ItemImportContext,
): ImportPlan<ItemInput> {
  const rows: { line: number; value: ItemInput }[] = [];
  const errors: RowError[] = [];
  const existing = new Set(ctx.existingNames.map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();

  for (const r of parsed.records) {
    const fail = (message: string) => errors.push({ line: r.line, message });

    const name = r.get("name", "item", "item name", "product", "product name");
    const category = r.get("category");
    const unit = r.get("unit", "uom", "counted in");
    const cost = parseNumberCell(r.get("cost price", "cost", "purchase price", "unit cost"));
    const price = parseNumberCell(r.get("sell price", "price", "mrp", "selling price"));
    const qty = parseNumberCell(r.get("opening qty", "qty", "quantity", "stock"));
    const hsn = r.get("hsn", "hsn code", "sac", "hsnsac");
    const gstRaw = r.get("gst rate", "gst", "gst%", "tax rate");
    const gst = parseNumberCell(gstRaw);
    const tracks = parseBoolCell(r.get("tracks expiry", "track expiry", "expiry tracked"));
    const expiryRaw = r.get("expiry date", "expiry", "expires", "best before");
    const expiry = parseDateCell(expiryRaw);

    if (name === "") {
      fail("no name");
      continue;
    }
    if (!ctx.categories.includes(category)) {
      fail(
        category === ""
          ? "no category"
          : `category "${category}" does not exist — add it in Settings first`,
      );
      continue;
    }
    if (!ctx.units.includes(unit)) {
      fail(unit === "" ? "no unit" : `unit "${unit}" is not on the units list`);
      continue;
    }
    if (cost === "invalid" || price === "invalid" || qty === "invalid") {
      fail("a price or quantity column is not a number");
      continue;
    }
    if ((cost ?? 0) < 0 || (price ?? 0) < 0) {
      fail("a price is negative");
      continue;
    }
    if ((qty ?? 0) < 0) {
      fail("opening quantity is negative");
      continue;
    }
    if (gst === "invalid" || (gst !== null && !GST_RATES.includes(gst as never))) {
      fail(`GST rate must be one of ${GST_RATES.join(", ")}`);
      continue;
    }
    if (tracks === "invalid") {
      fail("tracks expiry must be yes or no");
      continue;
    }
    if (expiryRaw !== "" && expiry === null) {
      fail("expiry date is not a date (use YYYY-MM-DD or DD-MM-YYYY)");
      continue;
    }
    if (expiry !== null && expiry < ctx.today) {
      fail("expiry date has already passed");
      continue;
    }
    // An expiry date on an item that does not track expiry would be dropped on
    // save, so the contradiction is reported rather than half-honoured.
    if (expiry !== null && tracks === false) {
      fail("an expiry date was given but tracks expiry is no");
      continue;
    }

    const key = name.trim().toLowerCase();
    if (seen.has(key)) {
      fail(`"${name}" appears twice in this file`);
      continue;
    }
    if (existing.has(key)) {
      fail(`"${name}" is already in Stock — edit it there, or rename this row`);
      continue;
    }
    seen.add(key);

    const tracksExpiry = tracks ?? true; // the Add Item form's default
    rows.push({
      line: r.line,
      value: {
        name: name.trim(),
        emoji: r.get("emoji", "icon") || "📦",
        imageUrl: null,
        category,
        unit,
        price: price ?? 0,
        costPrice: cost ?? 0,
        qty: qty ?? 0,
        tracksExpiry,
        expiryDate: tracksExpiry ? expiry : null,
        hsn,
        gstRate: gst ?? 0,
      },
    });
  }

  return { rows, errors };
}

// ─── Bulk stock movements (§7's bulk stock update) ──────────────────────────

export const MOVEMENT_CSV_HEADERS = [
  "Item", "Type", "Qty", "Date", "Unit cost", "Vendor", "Issued to",
  "Reason", "Remarks",
];

export interface MovementImportRow {
  consumableId: string;
  movementType: MovementType;
  qty: number;
  onDate: string;
  unitCost: number | null;
  vendorId: string | null;
  issuedTo: string | null;
  reason: string;
  remarks: string;
}

export interface MovementImportContext {
  /** Every live item, so a row can name either its code or its name. */
  items: { id: string; code: string; name: string; unit: string; currentStock: number }[];
  /** Every supplier, for the vendor a purchase came from. */
  vendors: NamedRef[];
  /** Everyone stock can be issued to. */
  holders: NamedRef[];
  today: string;
}

/**
 * Rows are validated against a RUNNING stock figure, not the opening one: three
 * issues of 4 against a stock of 10 must fail on the third, which is exactly what
 * the server will do when it applies them in order.
 */
export function planMovementImport(
  parsed: ParsedCsv,
  ctx: MovementImportContext,
): ImportPlan<MovementImportRow> {
  const rows: { line: number; value: MovementImportRow }[] = [];
  const errors: RowError[] = [];

  const byKey = new Map<string, MovementImportContext["items"][number]>();
  for (const i of ctx.items) {
    byKey.set(normalise(i.code), i);
    byKey.set(normalise(i.name), i);
  }
  const running = new Map(ctx.items.map((i) => [i.id, i.currentStock]));
  const vendors = refIndex(ctx.vendors);
  const holders = refIndex(ctx.holders);

  for (const r of parsed.records) {
    const fail = (message: string) => errors.push({ line: r.line, message });

    const itemRaw = r.get("item", "code", "item code", "name", "item name");
    const typeRaw = r.get("type", "movement", "movement type").toLowerCase();
    const qtyCell = parseNumberCell(r.get("qty", "quantity"));
    const dateRaw = r.get("date", "on date", "on");
    const onDate = parseDateCell(dateRaw) ?? (dateRaw === "" ? ctx.today : null);
    const costCell = parseNumberCell(r.get("unit cost", "cost", "rate"));
    const reason = r.get("reason");
    const vendorRaw = r.get("vendor", "supplier", "bought from");
    const vendorId = resolveRefCell(vendorRaw, vendors);
    const holderRaw = r.get("issued to", "issuedto", "given to", "holder");
    const issuedTo = resolveRefCell(holderRaw, holders);

    const item = byKey.get(normalise(itemRaw));
    if (!item) {
      fail(itemRaw === "" ? "no item" : `no item matches "${itemRaw}"`);
      continue;
    }
    if (!MOVEMENT_TYPES.includes(typeRaw as MovementType)) {
      fail(typeRaw === "" ? "no movement type" : `"${typeRaw}" is not a movement type`);
      continue;
    }
    const type = typeRaw as MovementType;

    if (qtyCell === "invalid" || qtyCell === null) {
      fail(qtyCell === null ? "no quantity" : "quantity is not a number");
      continue;
    }
    if (type === "adjustment" ? qtyCell === 0 : qtyCell <= 0) {
      fail(
        type === "adjustment"
          ? "an adjustment of zero changes nothing"
          : "quantity must be more than zero",
      );
      continue;
    }
    if (onDate === null) {
      fail("date is not a date (use YYYY-MM-DD or DD-MM-YYYY)");
      continue;
    }
    if (onDate > ctx.today) {
      fail("date is in the future");
      continue;
    }
    if (reasonRequired(type) && reason === "") {
      fail(`a ${type} needs a reason`);
      continue;
    }
    if (costCell === "invalid") {
      fail("unit cost is not a number");
      continue;
    }
    if (costCell !== null && type !== "purchase") {
      fail("a unit cost belongs on a purchase");
      continue;
    }
    if (costCell !== null && costCell < 0) {
      fail("unit cost is negative");
      continue;
    }
    // Both mirror the form, which only offers each field on its own movement type
    // and sends null on the rest. Accepting them silently would drop them.
    if (vendorId !== null && type !== "purchase") {
      fail("a vendor belongs on a purchase");
      continue;
    }
    if (vendorId === "unknown") {
      fail(`no supplier matches "${vendorRaw}" — use its name or code, e.g. SUP-0001`);
      continue;
    }
    if (issuedTo !== null && type !== "issue") {
      fail("an issued-to name belongs on an issue");
      continue;
    }
    if (issuedTo === "unknown") {
      fail(`nobody on the staff list is called "${holderRaw}"`);
      continue;
    }

    const signed =
      type === "purchase" || type === "return"
        ? Math.abs(qtyCell)
        : type === "adjustment"
          ? qtyCell
          : -Math.abs(qtyCell);
    const before = running.get(item.id) ?? 0;
    if (before + signed < 0) {
      fail(
        `only ${Number(before.toFixed(3))} ${item.unit} of ${item.name} would be on hand at that point`,
      );
      continue;
    }
    running.set(item.id, before + signed);

    rows.push({
      line: r.line,
      value: {
        consumableId: item.id,
        movementType: type,
        qty: qtyCell,
        onDate,
        unitCost: costCell,
        vendorId,
        issuedTo,
        reason,
        remarks: r.get("remarks", "note", "notes"),
      },
    });
  }

  return { rows, errors };
}

/** A header-only file for someone to fill in. */
export const templateCsv = (headers: string[]): string => headers.join(",") + "\r\n";
