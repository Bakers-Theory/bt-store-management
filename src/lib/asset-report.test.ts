import { describe, expect, it } from "vitest";
import {
  ASSET_REPORT_META,
  ASSET_REPORT_TYPES,
  assetReport,
  assetReportCsv,
  assetReportSheets,
  assetReportTables,
  type AssetReportData,
} from "./asset-report";
import type { Asset, AssetAssignment, AssetMaintenance } from "./types";

const shop = { name: "Bakers Theory", address: "MG Road", phone: "9876543210", currency: "₹" };

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  code: "AST-0001",
  name: "POS machine",
  category: "Electronics",
  brand: "",
  model: "",
  serialNumber: "SN-1",
  purchaseDate: "2026-01-10",
  purchasePrice: 20000,
  vendorId: null,
  vendorName: "",
  warrantyStart: null,
  warrantyExpiry: null,
  location: "Counter",
  department: "",
  assignedTo: null,
  assignedToName: "",
  status: "available",
  condition: "good",
  notes: "",
  imageUrl: null,
  documents: [],
  lastServiceDate: null,
  nextServiceDate: null,
  openAssignmentId: null,
  assignedOn: null,
  openMaintenanceId: null,
  openMaintenanceKind: null,
  warrantyDaysLeft: null,
  serviceDaysLeft: null,
  isArchived: false,
  archivedAt: null,
  createdAt: "2026-01-10T00:00:00Z",
  createdByName: "Owner",
  updatedAt: "2026-01-10T00:00:00Z",
  updatedByName: "Owner",
  ...over,
});

const custody = (over: Partial<AssetAssignment> = {}): AssetAssignment => ({
  id: "s1",
  assetId: "a1",
  assetCode: "AST-0001",
  assetName: "POS machine",
  assetCategory: "Electronics",
  employeeId: "e1",
  employeeName: "Asha",
  department: "Counter",
  assignedOn: "2026-07-01",
  returnedOn: "2026-07-11",
  isOpen: false,
  assignedByName: "Owner",
  receivedByName: "",
  remarks: "",
  returnRemarks: "",
  signatureUrl: null,
  createdAt: "2026-07-01T00:00:00Z",
  ...over,
});

const job = (over: Partial<AssetMaintenance> = {}): AssetMaintenance => ({
  id: "m1",
  assetId: "a1",
  assetCode: "AST-0001",
  assetName: "POS machine",
  assetCategory: "Electronics",
  kind: "repair",
  status: "closed",
  vendorId: null,
  vendorName: "FixIt",
  scheduledOn: null,
  startedOn: "2026-07-05",
  completedOn: "2026-07-08",
  cost: 1500,
  amcStart: null,
  amcEnd: null,
  amcRef: "",
  nextServiceOn: null,
  notes: "",
  createdByName: "Owner",
  createdAt: "2026-07-05T00:00:00Z",
  updatedAt: "2026-07-08T00:00:00Z",
  ...over,
});

const data = (over: Partial<AssetReportData> = {}): AssetReportData => ({
  shop,
  assets: [asset()],
  assignments: [custody()],
  maintenance: [job()],
  ...over,
});

const july = { from: "2026-07-01", to: "2026-07-31" };
const all = { from: null, to: null };

describe("report metadata", () => {
  it("marks exactly the two position reports as snapshots", () => {
    const snapshots = ASSET_REPORT_TYPES.filter((t) => ASSET_REPORT_META[t].snapshot);
    // A register is what you own now and a warranty is a position; the other two
    // are windows over events.
    expect(snapshots).toEqual(["register", "warranty"]);
  });

  it("gives every report a name and a unique sheet slug", () => {
    const slugs = ASSET_REPORT_TYPES.map((t) => ASSET_REPORT_META[t].slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const t of ASSET_REPORT_TYPES) expect(ASSET_REPORT_META[t].name).not.toBe("");
  });

  it("builds every report without throwing, empty or not", () => {
    for (const t of ASSET_REPORT_TYPES) {
      expect(() => assetReport(t, data(), july)).not.toThrow();
      expect(() =>
        assetReport(t, { shop, assets: [], assignments: [], maintenance: [] }, july),
      ).not.toThrow();
    }
  });
});

describe("asset register", () => {
  it("includes archived, retired and lost assets — a register omits nothing", () => {
    const d = data({
      assets: [
        asset(),
        asset({ id: "a2", code: "AST-0002", isArchived: true }),
        asset({ id: "a3", code: "AST-0003", status: "retired" }),
        asset({ id: "a4", code: "AST-0004", status: "lost" }),
      ],
    });
    const [table] = assetReportTables("register", d, all);
    expect(table.rows).toHaveLength(4);
  });

  it("marks an archived asset as such rather than hiding its status", () => {
    const d = data({ assets: [asset({ isArchived: true, status: "available" })] });
    const [table] = assetReportTables("register", d, all);
    expect(table.rows[0][5]).toBe("Available (archived)");
  });

  it("totals the purchase price", () => {
    const d = data({
      assets: [asset({ purchasePrice: 20000 }), asset({ id: "a2", purchasePrice: 5500.5 })],
    });
    const [table] = assetReportTables("register", d, all);
    expect(table.totals?.[8]).toBe(25500.5);
  });

  it("summarises by category, counting what is out", () => {
    const d = data({
      assets: [
        asset({ category: "Electronics", status: "assigned", assignedTo: "e1" }),
        asset({ id: "a2", category: "Electronics" }),
        asset({ id: "a3", category: "Vehicles", purchasePrice: 100 }),
      ],
    });
    const [, summary] = assetReportTables("register", d, all);
    expect(summary.rows).toEqual([
      ["Electronics", 2, 1, 40000],
      ["Vehicles", 1, 0, 100],
    ]);
  });

  it("ignores the date range — it is a snapshot", () => {
    const wide = assetReportTables("register", data(), all)[0].rows.length;
    const narrow = assetReportTables("register", data(), { from: "2099-01-01", to: "2099-01-02" })[0]
      .rows.length;
    expect(narrow).toBe(wide);
  });
});

describe("assignment report", () => {
  it("filters by the date the asset was issued, not the return", () => {
    const d = data({
      assignments: [
        custody({ id: "s1", assignedOn: "2026-06-28", returnedOn: "2026-07-02" }),
        custody({ id: "s2", assignedOn: "2026-07-03", returnedOn: null, isOpen: true }),
      ],
    });
    const [table] = assetReportTables("assignment", d, july);
    // The June issue is out of the window even though it was returned inside it.
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][0]).toBe("03-07-2026");
  });

  it("counts days out, and measures an open row to today", () => {
    const d = data({
      assignments: [custody({ assignedOn: "2026-07-01", returnedOn: "2026-07-11" })],
    });
    const [table] = assetReportTables("assignment", d, july);
    expect(table.rows[0][6]).toBe(10);
    expect(table.rows[0][5]).toBe("11-07-2026");

    const open = assetReportTables(
      "assignment",
      data({ assignments: [custody({ returnedOn: null, isOpen: true })] }),
      july,
    )[0];
    expect(open.rows[0][5]).toBe("Still out");
    expect(Number(open.rows[0][6])).toBeGreaterThan(0);
  });

  it("lists everything out now regardless of the range", () => {
    const d = data({
      assignments: [custody({ assignedOn: "2020-01-01", returnedOn: null, isOpen: true })],
    });
    const [table, outNow] = assetReportTables("assignment", d, july);
    expect(table.rows).toHaveLength(0); // outside the window
    expect(outNow.rows).toHaveLength(1); // but still in hand
  });
});

describe("maintenance report", () => {
  it("filters by the date the job started", () => {
    const d = data({
      maintenance: [job({ startedOn: "2026-06-30" }), job({ id: "m2", startedOn: "2026-07-02" })],
    });
    const [table] = assetReportTables("maintenance", d, july);
    expect(table.rows).toHaveLength(1);
  });

  it("totals the cost and counts open jobs", () => {
    const d = data({
      maintenance: [
        job({ cost: 1500 }),
        job({ id: "m2", cost: 500, status: "open", completedOn: null }),
      ],
    });
    const [table] = assetReportTables("maintenance", d, july);
    expect(table.totals?.[6]).toBe(2000);
    expect(table.totals?.[8]).toBe("1 open");
  });

  it("lists what is due for service, excluding retired and lost assets", () => {
    const d = data({
      assets: [
        asset({ id: "a1", nextServiceDate: "2026-08-01", serviceDaysLeft: 5 }),
        asset({ id: "a2", nextServiceDate: "2026-08-01", status: "retired" }),
        asset({ id: "a3", nextServiceDate: "2026-08-01", status: "lost" }),
        asset({ id: "a4", nextServiceDate: null }),
      ],
    });
    const [, due] = assetReportTables("maintenance", d, july);
    expect(due.rows).toHaveLength(1);
    expect(due.rows[0][6]).toBe("Due soon");
  });

  it("calls an overdue service overdue", () => {
    const d = data({ assets: [asset({ nextServiceDate: "2026-01-01", serviceDaysLeft: -12 })] });
    const [, due] = assetReportTables("maintenance", d, july);
    expect(due.rows[0][6]).toBe("Overdue");
  });
});

describe("warranty report", () => {
  it("separates 'no warranty recorded' from 'expired'", () => {
    const d = data({
      assets: [
        asset({ id: "a1", warrantyExpiry: "2026-09-01", warrantyDaysLeft: 27 }),
        asset({ id: "a2", warrantyExpiry: "2025-01-01", warrantyDaysLeft: -580 }),
        asset({ id: "a3", warrantyExpiry: null }),
      ],
    });
    const [covered, missing] = assetReportTables("warranty", d, all);
    expect(covered.rows).toHaveLength(2);
    expect(covered.rows.map((r) => r[7])).toEqual(["Expired", "Ending soon"]);
    expect(missing.rows).toHaveLength(1);
  });

  it("keeps a retired asset out of the 'no warranty' chase list", () => {
    const d = data({ assets: [asset({ warrantyExpiry: null, status: "retired" })] });
    const [, missing] = assetReportTables("warranty", d, all);
    expect(missing.rows).toHaveLength(0);
  });

  it("orders by expiry so the most urgent is first", () => {
    const d = data({
      assets: [
        asset({ id: "a1", warrantyExpiry: "2027-01-01", warrantyDaysLeft: 500 }),
        asset({ id: "a2", code: "AST-0002", warrantyExpiry: "2026-08-10", warrantyDaysLeft: 5 }),
      ],
    });
    const [covered] = assetReportTables("warranty", d, all);
    expect(covered.rows[0][0]).toBe("AST-0002");
  });
});

describe("renderers", () => {
  it("formats money for print but leaves it numeric for Excel", () => {
    const printed = assetReport("register", data(), all);
    const registerTable = printed.tables[0];
    expect(registerTable.rows[0][8]).toBe("₹20000.00");

    const sheets = assetReportSheets("register", data(), all);
    expect(sheets[0].rows[0]["Cost"]).toBe(20000);
  });

  it("pads a totals row to the column count so the table stays aligned", () => {
    const printed = assetReport("register", data(), all);
    for (const t of printed.tables) {
      if (t.totals) expect(t.totals).toHaveLength(t.columns.length);
    }
  });

  it("marks money and count columns as numeric for right alignment", () => {
    const printed = assetReport("maintenance", data(), july);
    const cols = printed.tables[0].columns;
    expect(cols[6]).toEqual({ label: "Cost", num: true });
    expect(cols[2]).toEqual({ label: "Asset", num: false });
  });

  it("says 'As of today' for a snapshot and the range otherwise", () => {
    expect(assetReport("register", data(), july).period).toBe("As of today");
    expect(assetReport("assignment", data(), july).period).toBe("1 Jul 2026 – 31 Jul 2026");
  });

  it("names one sheet per table, prefixed by the report slug", () => {
    const sheets = assetReportSheets("assignment", data(), july);
    expect(sheets.map((s) => s.name)).toEqual(["Assignments", "Assignments Out now"]);
  });

  it("writes one CSV per report, tables separated by a blank line", () => {
    const csv = assetReportCsv("register", data(), all);
    expect(csv).toContain("Code,Asset,Category");
    expect(csv).toContain("By category");
    expect(csv.split("\r\n\r\n").length).toBe(2);
  });

  it("quotes a value containing a comma", () => {
    const d = data({ assets: [asset({ name: "Oven, industrial" })] });
    expect(assetReportCsv("register", d, all)).toContain('"Oven, industrial"');
  });

  it("carries a note on every report", () => {
    for (const t of ASSET_REPORT_TYPES) {
      expect(assetReport(t, data(), july).note.length).toBeGreaterThan(20);
    }
  });
});
