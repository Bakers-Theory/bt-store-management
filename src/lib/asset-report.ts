/**
 * The asset reports (#91 §4.2), as data.
 *
 * Same shape as `supplier-report.ts` and `cashbook-report.ts`, deliberately, so
 * the app keeps one reporting idiom: each report is described once as raw rows —
 * numbers stay numbers — and three renderers walk the same tables.
 * `assetReport` formats money for the A4 document, `assetReportSheets` hands the
 * raw rows to Excel (where a number must arrive as a number to be summed), and
 * `assetReportCsv` writes one report per file.
 *
 * WHICH DATE EACH REPORT USES (the contract — getting it wrong makes two reports
 * over one period disagree):
 *   - Asset Register and Warranty are SNAPSHOTS: a register is what you own now,
 *     and a warranty is a position, not an event in a window.
 *   - Assignment groups by `assigned_on` — when custody changed hands.
 *   - Maintenance groups by `started_on` — when the job began, not when it was
 *     paid for. Its second table is a snapshot of what is due next.
 *
 * Depreciation (§4.2, marked "future" in the ticket) is deliberately absent:
 * it needs a method and a rate per category, which nothing in this app records.
 */
import { rangeLabel, type PrintReport, type ReportTable, type ShopInfo } from "./report";
import { inRange, ymdToDMY, type DateRange, type Sheet } from "./excel";
import { toCsv } from "./attendance";
import { round2 } from "./salary";
import {
  assetStatusLabel,
  conditionLabel,
  maintenanceKindLabel,
  serviceStatus,
  warrantyStatus,
} from "./asset";
import type { Asset, AssetAssignment, AssetMaintenance } from "./types";

export type AssetReportType = "register" | "assignment" | "maintenance" | "warranty";

export const ASSET_REPORT_TYPES: AssetReportType[] = [
  "register",
  "assignment",
  "maintenance",
  "warranty",
];

export const ASSET_REPORT_META: Record<
  AssetReportType,
  { name: string; slug: string; /** True when the date range does not apply. */ snapshot: boolean }
> = {
  register: { name: "Asset Register", slug: "Asset_Register", snapshot: true },
  assignment: { name: "Assignment Report", slug: "Assignments", snapshot: false },
  maintenance: { name: "Maintenance Report", slug: "Maintenance", snapshot: false },
  // A warranty is a position as it stands today, not a sum over a window.
  warranty: { name: "Warranty Report", slug: "Warranty", snapshot: true },
};

export interface AssetReportData {
  shop: ShopInfo;
  /** Every non-deleted asset, archived ones included — a register omits nothing. */
  assets: Asset[];
  assignments: AssetAssignment[];
  maintenance: AssetMaintenance[];
}

export interface AssetReportTable {
  heading?: string;
  header: string[];
  /** Column indices holding money — formatted for print, raw for Excel. */
  moneyCols: number[];
  /** Column indices holding plain figures: right-aligned, never money-formatted. */
  numCols?: number[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  empty: string;
}

const slug = (s: string) => (s || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const sum = (ns: number[]) => round2(ns.reduce((s, n) => s + n, 0));

/** ISO dates sort lexically, so newest-first needs no Date construction. */
const byDateDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

const pad = (row: (string | number)[], width: number): (string | number)[] => [
  ...row,
  ...Array(Math.max(0, width - row.length)).fill(""),
];

const dmy = (ymd: string | null) => (ymd ? ymdToDMY(ymd) : "—");

/** Whole days between two plain dates. Both are "YYYY-MM-DD", so UTC is safe. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// ─── Table builders, one per report ─────────────────────────────────────────

function registerTables(data: AssetReportData): AssetReportTable[] {
  const rows = data.assets
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const table: AssetReportTable = {
    header: [
      "Code", "Asset", "Category", "Serial", "Location", "Status",
      "Held by", "Bought", "Cost", "Condition",
    ],
    moneyCols: [8],
    rows: rows.map((a) => [
      a.code,
      a.name,
      a.category,
      a.serialNumber || "—",
      a.location,
      // Archived is not a status — it is an asset filed away, whatever its status.
      a.isArchived ? `${assetStatusLabel(a.status)} (archived)` : assetStatusLabel(a.status),
      a.assignedToName || "—",
      dmy(a.purchaseDate),
      a.purchasePrice,
      conditionLabel(a.condition),
    ]),
    totals: ["Total", `${rows.length} asset(s)`, "", "", "", "", "", "", sum(rows.map((a) => a.purchasePrice)), ""],
    empty: "No assets on the register.",
  };

  // A count per category, so the register opens with the shape of the estate.
  const byCategory = new Map<string, Asset[]>();
  for (const a of rows) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
  const summary: AssetReportTable = {
    heading: "By category",
    header: ["Category", "Assets", "Assigned", "Value"],
    moneyCols: [3],
    numCols: [1, 2],
    rows: [...byCategory.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, list]) => [
        category,
        list.length,
        list.filter((a) => a.status === "assigned").length,
        sum(list.map((a) => a.purchasePrice)),
      ]),
    totals: [
      "Total",
      rows.length,
      rows.filter((a) => a.status === "assigned").length,
      sum(rows.map((a) => a.purchasePrice)),
    ],
    empty: "No assets on the register.",
  };

  return [table, summary];
}

function assignmentTables(
  data: AssetReportData,
  range: DateRange,
): AssetReportTable[] {
  const rows = data.assignments
    .filter((r) => inRange(r.assignedOn, range))
    .slice()
    .sort((a, b) => byDateDesc(a.assignedOn, b.assignedOn) || a.assetCode.localeCompare(b.assetCode));

  // "Days out" is open-ended while the asset is still out, so an open row is
  // measured to today rather than left blank — that figure is the point of the
  // column.
  const today = new Date().toISOString().slice(0, 10);

  return [
    {
      header: [
        "Issued", "Code", "Asset", "Employee", "Department",
        "Returned", "Days out", "Issued by",
      ],
      moneyCols: [],
      numCols: [6],
      rows: rows.map((r) => [
        dmy(r.assignedOn),
        r.assetCode,
        r.assetName,
        r.employeeName,
        r.department || "—",
        r.returnedOn ? dmy(r.returnedOn) : "Still out",
        daysBetween(r.assignedOn, r.returnedOn ?? today),
        r.assignedByName || "—",
      ]),
      totals: [
        "Total",
        `${rows.length} movement(s)`,
        "",
        "",
        "",
        `${rows.filter((r) => r.isOpen).length} still out`,
        "",
        "",
      ],
      empty: "No assets were issued in this period.",
    },
    {
      heading: "Out now",
      header: ["Code", "Asset", "Employee", "Since", "Days out"],
      moneyCols: [],
      numCols: [4],
      // A snapshot section: everything currently out, whenever it was issued.
      rows: data.assignments
        .filter((r) => r.isOpen)
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
        .map((r) => [
          r.assetCode,
          r.assetName,
          r.employeeName,
          dmy(r.assignedOn),
          daysBetween(r.assignedOn, today),
        ]),
      empty: "Nothing is out with anyone.",
    },
  ];
}

function maintenanceTables(
  data: AssetReportData,
  range: DateRange,
): AssetReportTable[] {
  const jobs = data.maintenance
    .filter((m) => inRange(m.startedOn, range))
    .slice()
    .sort((a, b) => byDateDesc(a.startedOn, b.startedOn));

  const dueSoon = data.assets
    .filter((a) => a.nextServiceDate !== null && a.status !== "retired" && a.status !== "lost")
    .sort((a, b) => (a.nextServiceDate! < b.nextServiceDate! ? -1 : 1));

  return [
    {
      header: ["Started", "Code", "Asset", "Kind", "Vendor", "Finished", "Cost", "Next due", "Status"],
      moneyCols: [6],
      rows: jobs.map((m) => [
        dmy(m.startedOn),
        m.assetCode,
        m.assetName,
        maintenanceKindLabel(m.kind),
        m.vendorName || "—",
        m.completedOn ? dmy(m.completedOn) : "—",
        m.cost,
        dmy(m.nextServiceOn),
        m.status === "open" ? "Open" : "Closed",
      ]),
      totals: [
        "Total",
        `${jobs.length} job(s)`,
        "",
        "",
        "",
        "",
        sum(jobs.map((m) => m.cost)),
        "",
        `${jobs.filter((m) => m.status === "open").length} open`,
      ],
      empty: "No repairs or services in this period.",
    },
    {
      heading: "Service due",
      header: ["Code", "Asset", "Category", "Last service", "Next due", "Days left", "State"],
      moneyCols: [],
      numCols: [5],
      rows: dueSoon.map((a) => [
        a.code,
        a.name,
        a.category,
        dmy(a.lastServiceDate),
        dmy(a.nextServiceDate),
        a.serviceDaysLeft ?? "",
        serviceStatus(a.serviceDaysLeft) === "overdue"
          ? "Overdue"
          : serviceStatus(a.serviceDaysLeft) === "due"
            ? "Due soon"
            : "Scheduled",
      ]),
      empty: "Nothing has a service date recorded.",
    },
  ];
}

function warrantyTables(data: AssetReportData): AssetReportTable[] {
  // Only assets that actually carry a warranty. A blank expiry is not "expired",
  // it is "not recorded", and listing those as a risk would be a lie.
  const covered = data.assets
    .filter((a) => a.warrantyExpiry !== null)
    .sort((a, b) => (a.warrantyExpiry! < b.warrantyExpiry! ? -1 : 1));

  const state = (a: Asset) => {
    switch (warrantyStatus(a.warrantyDaysLeft)) {
      case "expired":
        return "Expired";
      case "expiring":
        return "Ending soon";
      case "active":
        return "In warranty";
      default:
        return "—";
    }
  };

  return [
    {
      header: ["Code", "Asset", "Category", "Vendor", "From", "Until", "Days left", "State", "Cost"],
      moneyCols: [8],
      numCols: [6],
      rows: covered.map((a) => [
        a.code,
        a.name,
        a.category,
        a.vendorName || "—",
        dmy(a.warrantyStart),
        dmy(a.warrantyExpiry),
        a.warrantyDaysLeft ?? "",
        state(a),
        a.purchasePrice,
      ]),
      totals: [
        "Total",
        `${covered.length} asset(s)`,
        "",
        "",
        "",
        "",
        "",
        `${covered.filter((a) => warrantyStatus(a.warrantyDaysLeft) === "expired").length} expired`,
        sum(covered.map((a) => a.purchasePrice)),
      ],
      empty: "No asset has a warranty recorded.",
    },
    {
      heading: "No warranty recorded",
      header: ["Code", "Asset", "Category", "Bought", "Cost"],
      moneyCols: [4],
      rows: data.assets
        .filter((a) => a.warrantyExpiry === null && a.status !== "retired")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => [a.code, a.name, a.category, dmy(a.purchaseDate), a.purchasePrice]),
      empty: "Every asset has its warranty recorded.",
    },
  ];
}

export function assetReportTables(
  type: AssetReportType,
  data: AssetReportData,
  range: DateRange,
): AssetReportTable[] {
  switch (type) {
    case "register":
      return registerTables(data);
    case "assignment":
      return assignmentTables(data, range);
    case "maintenance":
      return maintenanceTables(data, range);
    case "warranty":
      return warrantyTables(data);
  }
}

// ─── Print (A4) ─────────────────────────────────────────────────────────────

const NOTES: Record<AssetReportType, string> = {
  register:
    "Everything the store owns, archived assets included and marked as such — a " +
    "register that hides an asset is not a register. Retired and lost assets are " +
    "listed too: they are still part of the history, and nothing in this module is " +
    "ever hard-deleted. Value is the purchase price, not a depreciated figure.",
  assignment:
    "One row per custody movement, by the date the asset was issued. A row reading " +
    "\"Still out\" has no return date yet, and its days-out figure is counted to " +
    "today. The custody trail is append-only, so a returned asset keeps its row.",
  maintenance:
    "Jobs by the date they started. The cost shown is what the repair or service " +
    "cost — the payment itself lives in the cash book as an expense, so this figure " +
    "is for the asset's history, not a second set of accounts.",
  warranty:
    "A position as it stands today, not a total over the period. Assets with no " +
    "warranty recorded are listed separately: not recorded is not the same as " +
    "expired.",
};

function summaryFor(
  type: AssetReportType,
  tables: AssetReportTable[],
  money: (n: number) => string,
): { label: string; value: string }[] {
  const t = tables[0];
  const num = (row: (string | number)[] | undefined, i: number) => Number(row?.[i] ?? 0);
  switch (type) {
    case "register":
      return [
        { label: "Assets", value: String(t.rows.length) },
        { label: "Assigned", value: String(num(tables[1].totals, 2)) },
        { label: "Value", value: money(num(t.totals, 8)) },
      ];
    case "assignment":
      return [
        { label: "Movements", value: String(t.rows.length) },
        { label: "Out now", value: String(tables[1].rows.length) },
      ];
    case "maintenance":
      return [
        { label: "Jobs", value: String(t.rows.length) },
        { label: "Cost", value: money(num(t.totals, 6)) },
        { label: "Service due", value: String(tables[1].rows.length) },
      ];
    case "warranty":
      return [
        { label: "Under warranty", value: String(t.rows.length) },
        { label: "No warranty", value: String(tables[1].rows.length) },
      ];
  }
}

export function assetReport(
  type: AssetReportType,
  data: AssetReportData,
  range: DateRange,
): PrintReport {
  const meta = ASSET_REPORT_META[type];
  const cur = data.shop.currency || "₹";
  const money = (n: number) => `${cur}${n.toFixed(2)}`;
  const raw = assetReportTables(type, data, range);

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
    scope: "All assets",
    summary: summaryFor(type, raw, money),
    tables,
    note: NOTES[type],
    fileName: `${slug(data.shop.name)}-${slug(meta.name)}-${range.from || "all"}${
      range.to ? `-to-${range.to}` : ""
    }`,
  };
}

// ─── Excel ──────────────────────────────────────────────────────────────────

/**
 * One sheet per table, rows keyed by column header. Money stays numeric so the
 * spreadsheet can sum it — the whole point of exporting rather than printing.
 */
export function assetReportSheets(
  type: AssetReportType,
  data: AssetReportData,
  range: DateRange,
): Sheet[] {
  const meta = ASSET_REPORT_META[type];
  // Sheet names are truncated and deduplicated by lib/excel.ts, so a long
  // heading here is safe.
  return assetReportTables(type, data, range).map((t) => ({
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

/**
 * One report per file. Tables are separated by a blank line and keep their
 * heading, so a multi-table report survives the flat format.
 */
export function assetReportCsv(
  type: AssetReportType,
  data: AssetReportData,
  range: DateRange,
): string {
  const blocks = assetReportTables(type, data, range).map((t) => {
    const rows: (string | number)[][] = [];
    if (t.heading) rows.push([t.heading]);
    rows.push(t.header);
    rows.push(...t.rows);
    if (t.totals) rows.push(pad(t.totals, t.header.length));
    return toCsv(rows);
  });
  return blocks.join("\r\n\r\n");
}
