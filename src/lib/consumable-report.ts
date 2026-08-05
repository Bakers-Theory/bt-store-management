/**
 * The six consumable reports (#91 §4.2), as data. Same three-renderer shape as
 * `asset-report.ts` and `supplier-report.ts`.
 *
 * WHICH DATE EACH REPORT USES (the contract):
 *   - Inventory, Expiry and the suggested-orders section are SNAPSHOTS: stock on
 *     hand is a position, not a sum over a window.
 *   - Stock Movement, Consumption, Purchase and Wastage group by
 *     `stock_movement.on_date` — when the stock actually moved.
 *
 * HOW VALUE IS COMPUTED, and why it is stated on every report that shows it:
 * a movement only carries a `unit_cost` when it is a purchase, so outward value
 * (consumption, wastage) is valued at the item's LATEST purchase price, falling
 * back to its recorded cost per unit. That is an estimate by construction — the
 * ledger tracks quantity, and the money side of buying stock lives in the
 * expense module. Naming the figure "value" without saying so would imply an
 * accuracy this data does not have.
 */
import { rangeLabel, type PrintReport, type ReportTable, type ShopInfo } from "./report";
import { inRange, ymdToDMY, type DateRange, type Sheet } from "./excel";
import { toCsv } from "./attendance";
import { round2 } from "./salary";
import { movementTypeLabel, stockStatusLabel } from "./consumable";
import type { Consumable, MovementType, StockMovement } from "./types";

export type ConsumableReportType =
  | "inventory"
  | "movement"
  | "consumption"
  | "purchase"
  | "expiry"
  | "wastage";

export const CONSUMABLE_REPORT_TYPES: ConsumableReportType[] = [
  "inventory",
  "movement",
  "consumption",
  "purchase",
  "expiry",
  "wastage",
];

export const CONSUMABLE_REPORT_META: Record<
  ConsumableReportType,
  { name: string; slug: string; snapshot: boolean }
> = {
  inventory: { name: "Inventory Report", slug: "Inventory", snapshot: true },
  movement: { name: "Stock Movement Report", slug: "Stock_Movement", snapshot: false },
  consumption: { name: "Consumption Report", slug: "Consumption", snapshot: false },
  purchase: { name: "Purchase Report", slug: "Purchases", snapshot: false },
  expiry: { name: "Expiry Report", slug: "Expiry", snapshot: true },
  wastage: { name: "Wastage Report", slug: "Wastage", snapshot: false },
};

export interface ConsumableReportData {
  shop: ShopInfo;
  items: Consumable[];
  movements: StockMovement[];
}

export interface ConsumableReportTable {
  heading?: string;
  header: string[];
  moneyCols: number[];
  numCols?: number[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  empty: string;
}

const slug = (s: string) => (s || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const sum = (ns: number[]) => round2(ns.reduce((s, n) => s + n, 0));

/** Quantities carry three decimals in the schema; trailing zeros are noise. */
const qty = (n: number) => Number(n.toFixed(3));

const byDateDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

const pad = (row: (string | number)[], width: number): (string | number)[] => [
  ...row,
  ...Array(Math.max(0, width - row.length)).fill(""),
];

const dmy = (ymd: string | null) => (ymd ? ymdToDMY(ymd) : "—");

/** The estimate the header comment explains: latest purchase price, then the
 *  recorded cost per unit, then nothing. */
const unitValue = (c: Consumable | undefined): number =>
  c?.lastPurchaseCost ?? c?.costPerUnit ?? 0;

const WASTE_TYPES: MovementType[] = ["wastage", "expired", "damaged"];

// ─── Table builders ─────────────────────────────────────────────────────────

function inventoryTables(data: ConsumableReportData): ConsumableReportTable[] {
  const items = data.items
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const byCategory = new Map<string, Consumable[]>();
  for (const c of items) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);

  return [
    {
      header: [
        "Code", "Item", "Category", "Unit", "In stock", "Minimum",
        "Maximum", "Value", "Level",
      ],
      moneyCols: [7],
      numCols: [4, 5, 6],
      rows: items.map((c) => [
        c.code,
        c.name,
        c.category,
        c.unit,
        qty(c.currentStock),
        qty(c.minStock),
        c.maxStock === null ? "" : qty(c.maxStock),
        c.stockValue,
        stockStatusLabel(c.stockStatus),
      ]),
      totals: [
        "Total",
        `${items.length} item(s)`,
        "", "", "", "", "",
        sum(items.map((c) => c.stockValue)),
        `${items.filter((c) => c.stockStatus === "low" || c.stockStatus === "out").length} need action`,
      ],
      empty: "No consumable items yet.",
    },
    {
      heading: "By category",
      header: ["Category", "Items", "Below minimum", "Out of stock", "Value"],
      moneyCols: [4],
      numCols: [1, 2, 3],
      rows: [...byCategory.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, list]) => [
          category,
          list.length,
          list.filter((c) => c.stockStatus === "low").length,
          list.filter((c) => c.stockStatus === "out").length,
          sum(list.map((c) => c.stockValue)),
        ]),
      totals: [
        "Total",
        items.length,
        items.filter((c) => c.stockStatus === "low").length,
        items.filter((c) => c.stockStatus === "out").length,
        sum(items.map((c) => c.stockValue)),
      ],
      empty: "No consumable items yet.",
    },
  ];
}

function movementTables(
  data: ConsumableReportData,
  range: DateRange,
): ConsumableReportTable[] {
  const rows = data.movements
    .filter((m) => inRange(m.onDate, range))
    .slice()
    .sort((a, b) => byDateDesc(a.onDate, b.onDate) || a.itemName.localeCompare(b.itemName));

  const inQty = rows.filter((m) => m.qtySigned > 0);
  const outQty = rows.filter((m) => m.qtySigned < 0);

  return [
    {
      header: ["Date", "Code", "Item", "Type", "In", "Out", "Unit", "Reason", "By"],
      moneyCols: [],
      numCols: [4, 5],
      rows: rows.map((m) => [
        dmy(m.onDate),
        m.itemCode,
        m.itemName,
        movementTypeLabel(m.movementType),
        m.qtySigned > 0 ? qty(m.qtySigned) : "",
        m.qtySigned < 0 ? qty(-m.qtySigned) : "",
        m.unit,
        m.reason || m.remarks || "—",
        m.createdByName || "—",
      ]),
      totals: [
        "Total",
        `${rows.length} movement(s)`,
        "",
        "",
        qty(sum(inQty.map((m) => m.qtySigned))),
        qty(sum(outQty.map((m) => -m.qtySigned))),
        "",
        "",
        "",
      ],
      // Quantities across items are only comparable within one unit, so the
      // totals above are a tally of the ledger, not a physical quantity.
      empty: "No stock moved in this period.",
    },
  ];
}

/** Outward movement per item, split by why the stock left. */
function consumptionTables(
  data: ConsumableReportData,
  range: DateRange,
): ConsumableReportTable[] {
  const itemById = new Map(data.items.map((c) => [c.id, c]));
  const out = data.movements.filter(
    (m) => inRange(m.onDate, range) && m.qtySigned < 0,
  );

  const grouped = new Map<string, StockMovement[]>();
  for (const m of out) grouped.set(m.consumableId, [...(grouped.get(m.consumableId) ?? []), m]);

  const totalOf = (list: StockMovement[], types: MovementType[]) =>
    sum(list.filter((m) => types.includes(m.movementType)).map((m) => -m.qtySigned));

  const rows = [...grouped.entries()]
    .map(([id, list]) => {
      const item = itemById.get(id);
      const issued = totalOf(list, ["issue"]);
      const waste = totalOf(list, WASTE_TYPES);
      const adjusted = totalOf(list, ["adjustment"]);
      const total = round2(issued + waste + adjusted);
      return {
        name: item?.name ?? list[0].itemName,
        row: [
          list[0].itemCode,
          item?.name ?? list[0].itemName,
          list[0].unit,
          qty(issued),
          qty(waste),
          qty(adjusted),
          qty(total),
          round2(total * unitValue(item)),
        ] as (string | number)[],
        value: round2(total * unitValue(item)),
      };
    })
    .sort((a, b) => Number(b.row[6]) - Number(a.row[6]) || a.name.localeCompare(b.name));

  return [
    {
      header: ["Code", "Item", "Unit", "Issued", "Written off", "Adjusted", "Total out", "Est. value"],
      moneyCols: [7],
      numCols: [3, 4, 5, 6],
      rows: rows.map((r) => r.row),
      totals: [
        "Total",
        `${rows.length} item(s)`,
        "",
        "",
        "",
        "",
        "",
        sum(rows.map((r) => r.value)),
      ],
      empty: "Nothing was used in this period.",
    },
  ];
}

function purchaseTables(
  data: ConsumableReportData,
  range: DateRange,
): ConsumableReportTable[] {
  const itemById = new Map(data.items.map((c) => [c.id, c]));
  const purchases = data.movements.filter(
    (m) => inRange(m.onDate, range) && m.movementType === "purchase",
  );

  const grouped = new Map<string, StockMovement[]>();
  for (const m of purchases)
    grouped.set(m.consumableId, [...(grouped.get(m.consumableId) ?? []), m]);

  const bought = [...grouped.entries()]
    .map(([id, list]) => {
      const item = itemById.get(id);
      const q = sum(list.map((m) => m.qty));
      const value = sum(list.map((m) => m.movementValue));
      return {
        name: item?.name ?? list[0].itemName,
        value,
        row: [
          list[0].itemCode,
          item?.name ?? list[0].itemName,
          list[0].unit,
          qty(q),
          value,
          // The average actually paid over the period, which is the figure worth
          // comparing against the last price.
          q > 0 ? round2(value / q) : 0,
          list[0].vendorName || "—",
        ] as (string | number)[],
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  // §3.5's recommendations, which the ticket asks to surface on this report.
  const suggested = data.items
    .filter((c) => c.recommendedQty > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [
    {
      header: ["Code", "Item", "Unit", "Qty bought", "Spend", "Avg cost", "Vendor"],
      moneyCols: [4, 5],
      numCols: [3],
      rows: bought.map((b) => b.row),
      totals: ["Total", `${bought.length} item(s)`, "", "", sum(bought.map((b) => b.value)), "", ""],
      empty: "Nothing was bought in this period.",
    },
    {
      heading: "Suggested orders",
      header: ["Code", "Item", "Unit", "On hand", "Minimum", "Suggested", "Est. cost", "Vendor"],
      moneyCols: [6],
      numCols: [3, 4, 5],
      rows: suggested.map((c) => [
        c.code,
        c.name,
        c.unit,
        qty(c.currentStock),
        qty(c.minStock),
        qty(c.recommendedQty),
        round2(c.recommendedQty * unitValue(c)),
        c.vendorName || "—",
      ]),
      totals: [
        "Total",
        `${suggested.length} item(s)`,
        "", "", "", "",
        sum(suggested.map((c) => c.recommendedQty * unitValue(c))),
        "",
      ],
      empty: "Nothing needs ordering.",
    },
  ];
}

function expiryTables(data: ConsumableReportData): ConsumableReportTable[] {
  // Only items that carry an expiry date, and only while there is stock to lose.
  const dated = data.items
    .filter((c) => c.expiryDate !== null)
    .sort((a, b) => (a.expiryDate! < b.expiryDate! ? -1 : 1));

  const state = (c: Consumable) => {
    const d = c.expiryDaysLeft;
    if (d === null) return "—";
    if (d < 0) return "Expired";
    if (d <= 30) return "Expiring soon";
    return "In date";
  };

  const atRisk = dated.filter((c) => c.currentStock > 0);

  return [
    {
      header: ["Code", "Item", "Category", "Expires", "Days left", "On hand", "Unit", "Value", "State"],
      moneyCols: [7],
      numCols: [4, 5],
      rows: dated.map((c) => [
        c.code,
        c.name,
        c.category,
        dmy(c.expiryDate),
        c.expiryDaysLeft ?? "",
        qty(c.currentStock),
        c.unit,
        c.stockValue,
        state(c),
      ]),
      totals: [
        "Total",
        `${dated.length} item(s)`,
        "", "", "", "", "",
        sum(atRisk.map((c) => c.stockValue)),
        `${atRisk.filter((c) => (c.expiryDaysLeft ?? 1) < 0).length} expired with stock`,
      ],
      empty: "No item has an expiry date recorded.",
    },
  ];
}

function wastageTables(
  data: ConsumableReportData,
  range: DateRange,
): ConsumableReportTable[] {
  const itemById = new Map(data.items.map((c) => [c.id, c]));
  const rows = data.movements
    .filter((m) => inRange(m.onDate, range) && WASTE_TYPES.includes(m.movementType))
    .slice()
    .sort((a, b) => byDateDesc(a.onDate, b.onDate));

  const valued = rows.map((m) => round2(m.qty * unitValue(itemById.get(m.consumableId))));

  const byType = WASTE_TYPES.map((t) => {
    const mine = rows.filter((m) => m.movementType === t);
    return [
      movementTypeLabel(t),
      mine.length,
      qty(sum(mine.map((m) => m.qty))),
      sum(mine.map((m) => round2(m.qty * unitValue(itemById.get(m.consumableId))))),
    ] as (string | number)[];
  });

  return [
    {
      header: ["Date", "Code", "Item", "Type", "Qty", "Unit", "Est. value", "Reason", "By"],
      moneyCols: [6],
      numCols: [4],
      rows: rows.map((m, i) => [
        dmy(m.onDate),
        m.itemCode,
        m.itemName,
        movementTypeLabel(m.movementType),
        qty(m.qty),
        m.unit,
        valued[i],
        // A reason is required on every one of these types, so it is never blank.
        m.reason,
        m.createdByName || "—",
      ]),
      totals: ["Total", `${rows.length} write-off(s)`, "", "", "", "", sum(valued), "", ""],
      empty: "Nothing was written off in this period.",
    },
    {
      heading: "By reason type",
      header: ["Type", "Entries", "Qty", "Est. value"],
      moneyCols: [3],
      numCols: [1, 2],
      rows: byType,
      totals: ["Total", rows.length, "", sum(valued)],
      empty: "Nothing was written off in this period.",
    },
  ];
}

export function consumableReportTables(
  type: ConsumableReportType,
  data: ConsumableReportData,
  range: DateRange,
): ConsumableReportTable[] {
  switch (type) {
    case "inventory":
      return inventoryTables(data);
    case "movement":
      return movementTables(data, range);
    case "consumption":
      return consumptionTables(data, range);
    case "purchase":
      return purchaseTables(data, range);
    case "expiry":
      return expiryTables(data);
    case "wastage":
      return wastageTables(data, range);
  }
}

// ─── Print (A4) ─────────────────────────────────────────────────────────────

const NOTES: Record<ConsumableReportType, string> = {
  inventory:
    "Stock on hand as it stands today. Every figure is the sum of the movement " +
    "ledger — there is no separately stored stock number that could disagree with " +
    "it. Value is priced at the latest purchase cost, or the recorded cost per " +
    "unit where nothing has been bought yet.",
  movement:
    "Every entry in the ledger for the period, by the date the stock moved. " +
    "Entries are never edited or deleted: a correction appears as its own " +
    "adjustment row, with its reason. The In and Out totals tally the ledger " +
    "across items, so they are only physically meaningful within one unit.",
  consumption:
    "Outward movement only, so a purchase never cancels out usage. \"Written off\" " +
    "combines wastage, expiry and damage; \"Adjusted\" is the net of downward stock " +
    "corrections. Value is an estimate at the latest purchase price.",
  purchase:
    "Stock received in the period, valued at the unit cost recorded on each " +
    "purchase. This is not a payment record — the money side of buying lives in " +
    "the cash book as an expense or a purchase invoice. The suggested orders " +
    "below are a position as it stands today, not part of the period.",
  expiry:
    "A position as it stands today. Items with no expiry date recorded are " +
    "excluded: most consumables do not perish, and listing them as unknown risk " +
    "would bury the ones that do. Value counts only items that still have stock.",
  wastage:
    "Stock that left without being used: spoiled, expired or damaged. Every one of " +
    "these entries carries a reason, because the system requires one. Value is an " +
    "estimate at the latest purchase price.",
};

function summaryFor(
  type: ConsumableReportType,
  tables: ConsumableReportTable[],
  money: (n: number) => string,
): { label: string; value: string }[] {
  const t = tables[0];
  const num = (row: (string | number)[] | undefined, i: number) => Number(row?.[i] ?? 0);
  switch (type) {
    case "inventory":
      return [
        { label: "Items", value: String(t.rows.length) },
        { label: "Stock value", value: money(num(t.totals, 7)) },
        {
          label: "Need action",
          value: String(num(tables[1].totals, 2) + num(tables[1].totals, 3)),
        },
      ];
    case "movement":
      return [
        { label: "Movements", value: String(t.rows.length) },
        { label: "Total in", value: String(num(t.totals, 4)) },
        { label: "Total out", value: String(num(t.totals, 5)) },
      ];
    case "consumption":
      return [
        { label: "Items used", value: String(t.rows.length) },
        { label: "Est. value", value: money(num(t.totals, 7)) },
      ];
    case "purchase":
      return [
        { label: "Items bought", value: String(t.rows.length) },
        { label: "Spend", value: money(num(t.totals, 4)) },
        { label: "To order", value: String(tables[1].rows.length) },
      ];
    case "expiry":
      return [
        { label: "Dated items", value: String(t.rows.length) },
        { label: "Value at risk", value: money(num(t.totals, 7)) },
      ];
    case "wastage":
      return [
        { label: "Write-offs", value: String(t.rows.length) },
        { label: "Est. value lost", value: money(num(t.totals, 6)) },
      ];
  }
}

export function consumableReport(
  type: ConsumableReportType,
  data: ConsumableReportData,
  range: DateRange,
): PrintReport {
  const meta = CONSUMABLE_REPORT_META[type];
  const cur = data.shop.currency || "₹";
  const money = (n: number) => `${cur}${n.toFixed(2)}`;
  const raw = consumableReportTables(type, data, range);

  const format = (row: (string | number)[], moneyCols: number[]) =>
    row.map((v, i) => (moneyCols.includes(i) && typeof v === "number" ? money(v) : v));

  const tables: ReportTable[] = raw.map((t) => ({
    heading: t.heading,
    columns: t.header.map((label, i) => ({
      label,
      num: t.moneyCols.includes(i) || (t.numCols ?? []).includes(i),
    })),
    rows: t.rows.map((r) => format(r, t.moneyCols)),
    totals: t.totals ? pad(format(t.totals, t.moneyCols), t.header.length) : undefined,
    empty: t.empty,
  }));

  return {
    kind: "report" as const,
    shop: data.shop.name || "Bakery",
    shopMeta: [data.shop.address, data.shop.phone].filter(Boolean).join(" · "),
    title: meta.name,
    period: meta.snapshot ? "As of today" : rangeLabel(range.from, range.to),
    scope: "All consumables",
    summary: summaryFor(type, raw, money),
    tables,
    note: NOTES[type],
    fileName: `${slug(data.shop.name)}-${slug(meta.name)}-${range.from || "all"}${
      range.to ? `-to-${range.to}` : ""
    }`,
  };
}

// ─── Excel ──────────────────────────────────────────────────────────────────

export function consumableReportSheets(
  type: ConsumableReportType,
  data: ConsumableReportData,
  range: DateRange,
): Sheet[] {
  const meta = CONSUMABLE_REPORT_META[type];
  return consumableReportTables(type, data, range).map((t) => ({
    name: t.heading ? `${meta.slug} ${t.heading}` : meta.slug,
    rows: t.rows.map(
      (row) =>
        Object.fromEntries(t.header.map((h, n) => [h, row[n] ?? ""])) as Record<
          string,
          string | number
        >,
    ),
  }));
}

// ─── CSV ────────────────────────────────────────────────────────────────────

export function consumableReportCsv(
  type: ConsumableReportType,
  data: ConsumableReportData,
  range: DateRange,
): string {
  const blocks = consumableReportTables(type, data, range).map((t) => {
    const rows: (string | number)[][] = [];
    if (t.heading) rows.push([t.heading]);
    rows.push(t.header);
    rows.push(...t.rows);
    if (t.totals) rows.push(pad(t.totals, t.header.length));
    return toCsv(rows);
  });
  return blocks.join("\r\n\r\n");
}
