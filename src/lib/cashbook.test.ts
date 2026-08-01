import { describe, expect, it } from "vitest";
import {
  accountBalance,
  accountLabel,
  cashDifference,
  differenceLabel,
  entryTypeLabel,
  expectedCash,
  modeToAccount,
  periodLabel,
  postableCategories,
  signedAmount,
} from "./cashbook";
import type { CashCategory, CashEntry } from "./types";

/** A minimal entry; each test overrides only what it cares about. */
const entry = (over: Partial<CashEntry> = {}): CashEntry => ({
  id: "e1",
  onDate: "2026-07-31",
  createdAt: "2026-07-31T04:00:00.000Z",
  account: "cash",
  direction: "in",
  amount: 100,
  paymentMode: "Cash",
  categoryId: "c1",
  categoryName: "Sales",
  categoryGroup: "",
  categoryPath: "Sales",
  sourceType: "bill",
  sourceId: "b1",
  sourceRef: "#1",
  reversesId: null,
  transferId: null,
  referenceNo: "",
  note: "",
  createdById: "u1",
  createdByName: "Ravi",
  status: "posted",
  runningBalance: 0,
  ...over,
});

describe("modeToAccount", () => {
  it("puts physical cash in the drawer and everything else in the bank", () => {
    expect(modeToAccount("Cash")).toBe("cash");
    expect(modeToAccount("UPI")).toBe("bank");
    expect(modeToAccount("Bank Transfer")).toBe("bank");
  });

  it("maps the legacy Cheque mode to bank so historical supplier payments read", () => {
    expect(modeToAccount("Cheque")).toBe("bank");
  });
});

describe("accountLabel", () => {
  it("names each account the way the operator would", () => {
    expect(accountLabel("cash")).toBe("Cash in hand");
    expect(accountLabel("bank")).toBe("Bank");
  });
});

describe("entryTypeLabel", () => {
  it("labels each posting source the way the operator thinks of it", () => {
    expect(entryTypeLabel(entry({ sourceType: "bill" }))).toBe("POS Sale");
    expect(entryTypeLabel(entry({ sourceType: "expense" }))).toBe("Cash Expense");
    expect(entryTypeLabel(entry({ sourceType: "salary" }))).toBe("Salary Payment");
    expect(entryTypeLabel(entry({ sourceType: "advance" }))).toBe("Staff Advance");
    expect(entryTypeLabel(entry({ sourceType: "supplier_payment" }))).toBe("Vendor Payment");
    expect(entryTypeLabel(entry({ sourceType: "transfer" }))).toBe("Transfer");
    expect(entryTypeLabel(entry({ sourceType: "opening" }))).toBe("Opening Balance");
  });

  it("calls a reversal a Refund whatever it reverses", () => {
    expect(entryTypeLabel(entry({ sourceType: "bill", reversesId: "x" }))).toBe("Refund");
    expect(entryTypeLabel(entry({ sourceType: "salary", reversesId: "x" }))).toBe("Refund");
  });

  it("distinguishes petty cash from a plain adjustment by its category", () => {
    expect(
      entryTypeLabel(entry({ sourceType: "manual", categoryName: "Petty Cash" })),
    ).toBe("Petty Cash");
    expect(
      entryTypeLabel(entry({ sourceType: "manual", categoryName: "Rent" })),
    ).toBe("Manual Adjustment");
  });
});

describe("postableCategories", () => {
  const cat = (over: Partial<CashCategory>): CashCategory => ({
    id: "x",
    parentId: null,
    name: "X",
    direction: "out",
    isSystem: false,
    sortOrder: 0,
    ...over,
  });

  const tree: CashCategory[] = [
    cat({ id: "sys", name: "Sales", direction: "in", isSystem: true }),
    cat({ id: "g1", name: "Utilities" }),
    cat({ id: "l1", parentId: "g1", name: "Rent" }),
    cat({ id: "l2", parentId: "g1", name: "Electricity" }),
    cat({ id: "f1", name: "Packaging" }),
    cat({ id: "f2", name: "Other Income", direction: "in" }),
    cat({ id: "f3", name: "Adjustment", direction: "both" }),
  ];

  it("offers a childless top-level category as postable in its own right", () => {
    // The bug this exists to prevent: `post_cash` accepts a childless top-level
    // category (it IS a leaf), so a picker must not hide it.
    const { flat } = postableCategories(tree);
    expect(flat.map((c) => c.name).sort()).toEqual([
      "Adjustment",
      "Other Income",
      "Packaging",
    ]);
  });

  it("groups a parent with its children and never lists the parent as postable", () => {
    const { groups, flat } = postableCategories(tree);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("Utilities");
    expect(groups[0].leaves.map((l) => l.name)).toEqual(["Rent", "Electricity"]);
    expect(flat.map((c) => c.name)).not.toContain("Utilities");
  });

  it("never offers a system category — those are posted automatically", () => {
    const all = postableCategories(tree);
    const names = [...all.flat, ...all.groups.flatMap((g) => g.leaves)].map((c) => c.name);
    expect(names).not.toContain("Sales");
  });

  it("filters to the direction the money is moving, keeping `both`", () => {
    const inbound = postableCategories(tree, "in");
    expect(inbound.flat.map((c) => c.name).sort()).toEqual([
      "Adjustment",
      "Other Income",
    ]);
    // Utilities' children are all money-out, so the group drops away entirely
    // rather than rendering as an empty heading.
    expect(inbound.groups).toHaveLength(0);

    const outbound = postableCategories(tree, "out");
    expect(outbound.flat.map((c) => c.name).sort()).toEqual(["Adjustment", "Packaging"]);
    expect(outbound.groups[0].leaves).toHaveLength(2);
  });
});

describe("periodLabel", () => {
  const today = "2026-07-31";

  it("says All time for an unbounded range", () => {
    expect(periodLabel({ from: null, to: null }, today)).toBe("All time");
  });

  it("says Today only when the single day IS today", () => {
    expect(periodLabel({ from: today, to: today }, today)).toBe("Today");
    expect(periodLabel({ from: "2026-07-12", to: "2026-07-12" }, today)).toBe("12 Jul");
  });

  it("renders a span without repeating the current year", () => {
    expect(periodLabel({ from: "2026-07-01", to: "2026-07-31" }, today)).toBe(
      "1 Jul \u2013 31 Jul",
    );
  });

  it("keeps the year on a date outside the current one", () => {
    expect(periodLabel({ from: "2025-12-25", to: "2025-12-25" }, today)).toBe(
      "25 Dec 2025",
    );
  });

  it("handles a half-open range from either side", () => {
    expect(periodLabel({ from: "2026-07-01", to: null }, today)).toBe("From 1 Jul");
    expect(periodLabel({ from: null, to: "2026-07-15" }, today)).toBe("Up to 15 Jul");
  });
});

describe("signedAmount", () => {
  it("is positive for money in and negative for money out", () => {
    expect(signedAmount(entry({ direction: "in", amount: 250 }))).toBe(250);
    expect(signedAmount(entry({ direction: "out", amount: 250 }))).toBe(-250);
  });
});

describe("accountBalance", () => {
  it("nets in against out for one account only", () => {
    const rows = [
      entry({ account: "cash", direction: "in", amount: 500 }),
      entry({ account: "cash", direction: "out", amount: 120 }),
      entry({ account: "bank", direction: "in", amount: 9000 }),
    ];
    expect(accountBalance(rows, "cash")).toBe(380);
    expect(accountBalance(rows, "bank")).toBe(9000);
  });

  it("is zero for an account with no entries", () => {
    expect(accountBalance([], "cash")).toBe(0);
  });

  it("rounds to paise so floating point cannot leak a fraction", () => {
    const rows = [
      entry({ direction: "in", amount: 0.1 }),
      entry({ direction: "in", amount: 0.2 }),
    ];
    expect(accountBalance(rows, "cash")).toBe(0.3);
  });
});

describe("expectedCash", () => {
  it("is opening plus cash in minus cash out, ignoring bank entries", () => {
    const rows = [
      entry({ account: "cash", direction: "in", amount: 1200 }),
      entry({ account: "cash", direction: "out", amount: 300 }),
      // A bank transfer out never touches the drawer.
      entry({ account: "bank", direction: "out", amount: 5000 }),
    ];
    expect(expectedCash(7200, rows)).toBe(8100);
  });

  it("is the opening figure when nothing moved", () => {
    expect(expectedCash(7200, [])).toBe(7200);
  });
});

describe("cashDifference", () => {
  it("is counted minus expected, so a shortfall is negative", () => {
    expect(cashDifference(5850, 5900)).toBe(-50);
    expect(cashDifference(9320, 9120)).toBe(200);
    expect(cashDifference(5900, 5900)).toBe(0);
  });

  it("rounds, so a paise-level float cannot read as a discrepancy", () => {
    expect(cashDifference(0.3, 0.1 + 0.2)).toBe(0);
  });
});

describe("differenceLabel", () => {
  it("names the three outcomes", () => {
    expect(differenceLabel(-50)).toEqual({ tone: "short", label: "Short" });
    expect(differenceLabel(200)).toEqual({ tone: "excess", label: "Excess" });
    expect(differenceLabel(0)).toEqual({ tone: "exact", label: "Tallied" });
  });
});
