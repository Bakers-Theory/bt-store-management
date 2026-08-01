import { round2 } from "./salary";
import { inRange, ymdToDMY, type DateRange } from "./excel";
import { rangeLabel, type ReportTable, type ShopInfo, type PrintReport } from "./report";
import { toCsv } from "./attendance";
import type { Sheet } from "./excel";
import type { CashDay, CashEntry, Expense } from "./types";

/**
 * The nine cashbook reports. Pure builders over already-fetched rows — the same
 * shape `supplier-report.ts` uses, deliberately, so the app has one reporting
 * idiom rather than two.
 *
 * WHICH DATE EACH REPORT GROUPS BY (this is the contract; getting it wrong makes
 * two reports over one period disagree):
 *   - cash reports (dayBook, monthlyCash, cashFlow, discrepancy, paymentMode,
 *     incomeVsExpense) group by `cash_entry.on_date` — when the money moved.
 *   - expense reports (expenseRegister, categoryBreakdown, vendorBreakdown)
 *     group by `expense.expense_date` — when the cost was incurred.
 */
export type CashbookReportType =
  | "dayBook"
  | "monthlyCash"
  | "expenseRegister"
  | "categoryBreakdown"
  | "vendorBreakdown"
  | "paymentMode"
  | "cashFlow"
  | "incomeVsExpense"
  | "discrepancy";

export const CASHBOOK_REPORT_TYPES: CashbookReportType[] = [
  "dayBook",
  "monthlyCash",
  "expenseRegister",
  "categoryBreakdown",
  "vendorBreakdown",
  "paymentMode",
  "cashFlow",
  "incomeVsExpense",
  "discrepancy",
];

export const CASHBOOK_REPORT_META: Record<
  CashbookReportType,
  { name: string; slug: string; hint: string; snapshot: boolean }
> = {
  dayBook: {
    name: "Daily Cash Book",
    slug: "daily_cash_book",
    hint: "Every entry day by day, with opening, closing, counted and difference",
    snapshot: false,
  },
  monthlyCash: {
    name: "Monthly Cash Report",
    slug: "monthly_cash",
    hint: "One row per day: in, out, net and closing balance",
    snapshot: false,
  },
  expenseRegister: {
    name: "Expense Report",
    slug: "expense_register",
    hint: "Every expense with vendor, category, GST, mode and status",
    snapshot: false,
  },
  categoryBreakdown: {
    name: "Category-wise Expense Report",
    slug: "expense_by_category",
    hint: "Expenses grouped by category, with share of total",
    snapshot: false,
  },
  vendorBreakdown: {
    name: "Vendor-wise Expense Report",
    slug: "expense_by_vendor",
    hint: "Expenses grouped by vendor, with count and total",
    snapshot: false,
  },
  paymentMode: {
    name: "Payment Mode Report",
    slug: "payment_mode",
    hint: "Money in and out by payment method, per account",
    snapshot: false,
  },
  cashFlow: {
    name: "Cash Flow Report",
    slug: "cash_flow",
    hint: "Opening, in, out and closing for both cash and bank",
    snapshot: false,
  },
  incomeVsExpense: {
    name: "Income vs Expense Report",
    slug: "income_vs_expense",
    hint: "Category totals both sides, net movement, versus the previous period",
    snapshot: false,
  },
  discrepancy: {
    name: "Cash Discrepancy Report",
    slug: "cash_discrepancy",
    hint: "Only the days whose count didn't match, and by how much",
    snapshot: false,
  },
};

/** Everything the nine builders need. Fetched by `fetchCashbookReportData`. */
export interface CashbookReportData {
  shop: ShopInfo;
  /** Ledger rows in range, oldest first. Reversals INCLUDED — they net out. */
  entries: CashEntry[];
  /** Closed days in range. */
  days: CashDay[];
  /** Expenses in range, by `expenseDate`. */
  expenses: Expense[];
  /** The cash balance strictly before the range's start. Decision 3. */
  openingCash: number;
  /** The bank balance strictly before the range's start. */
  openingBank: number;
  /** Ledger rows for the immediately preceding window of equal length. */
  prevEntries: CashEntry[];
  /** COGS for the range, or null without `dashboard.profit`. */
  cogs: number | null;
}

const signed = (e: CashEntry) => (e.direction === "in" ? e.amount : -e.amount);
const sum = (ns: number[]) => round2(ns.reduce((a, b) => a + b, 0));

/** Distinct `on_date`s present, oldest first. */
const datesOf = (entries: CashEntry[]): string[] =>
  [...new Set(entries.map((e) => e.onDate))].sort();

const pct = (part: number, whole: number) =>
  whole === 0 ? "0.0%" : `${round2((part / whole) * 100).toFixed(1)}%`;

// ─── 1. Daily Cash Book ─────────────────────────────────────────────────────
/**
 * One table per day, newest first. Groups by `onDate`.
 *
 * The opening balance for the FIRST day in range comes from
 * `data.openingCash` — the client cannot derive it without the entire prior
 * ledger — and each subsequent day chains from the one before.
 */
export function dayBookTables(
  data: CashbookReportData,
  range: DateRange,
): ReportTable[] {
  const rows = data.entries.filter((e) => inRange(e.onDate, range) && e.account === "cash");
  const dates = datesOf(rows);

  if (dates.length === 0) {
    return [
      {
        columns: [{ label: "Date" }, { label: "Details" }, { label: "Amount", num: true }],
        rows: [],
        empty: "No cash moved in this period",
      },
    ];
  }

  // Chain forward, then present newest-first.
  let opening = data.openingCash;
  const byDay = dates.map((date) => {
    const dayRows = rows.filter((e) => e.onDate === date);
    const closing = round2(opening + sum(dayRows.map(signed)));
    const table = { date, opening, closing, dayRows };
    opening = closing;
    return table;
  });

  return byDay.reverse().map(({ date, opening: op, closing, dayRows }) => {
    const d = data.days.find((x) => x.onDate === date);
    const body: (string | number)[][] = dayRows.map((e) => [
      e.createdAt.slice(11, 16),
      `${e.categoryPath}${e.sourceRef ? ` · ${e.sourceRef}` : ""}${e.note ? ` · ${e.note}` : ""}`,
      signed(e),
    ]);
    if (d) {
      body.push(["", "Counted in the drawer", d.countedCash]);
      body.push(["", d.difference === 0 ? "Tallied" : "Difference", d.difference]);
      if (d.remarks) body.push(["", `Remarks: ${d.remarks}`, ""]);
    }
    return {
      heading: `${ymdToDMY(date)}${d ? ` · closed by ${d.closedByName}` : " · not closed"}`,
      columns: [{ label: "Time" }, { label: "Details" }, { label: "Amount", num: true }],
      rows: body,
      totals: ["", "Closing balance", closing],
    };
  });
}

// ─── 2. Monthly Cash Report ─────────────────────────────────────────────────
/** One row per day: in, out, net, closing. Cash only. Groups by `onDate`. */
export function monthlyCashTable(
  data: CashbookReportData,
  range: DateRange,
): ReportTable {
  const rows = data.entries.filter((e) => inRange(e.onDate, range) && e.account === "cash");
  let running = data.openingCash;
  const body = datesOf(rows).map((date) => {
    const dayRows = rows.filter((e) => e.onDate === date);
    const cin = sum(dayRows.filter((e) => e.direction === "in").map((e) => e.amount));
    const cout = sum(dayRows.filter((e) => e.direction === "out").map((e) => e.amount));
    running = round2(running + cin - cout);
    return [ymdToDMY(date), cin, cout, round2(cin - cout), running];
  });

  const totalIn = sum(rows.filter((e) => e.direction === "in").map((e) => e.amount));
  const totalOut = sum(rows.filter((e) => e.direction === "out").map((e) => e.amount));

  return {
    columns: [
      { label: "Date" },
      { label: "Cash in", num: true },
      { label: "Cash out", num: true },
      { label: "Net", num: true },
      { label: "Closing", num: true },
    ],
    rows: body,
    totals: ["Total", totalIn, totalOut, round2(totalIn - totalOut), running],
    empty: "No cash moved in this period",
  };
}

// ─── 3. Expense Report ──────────────────────────────────────────────────────
/**
 * The expense register. Groups by `expenseDate`. Every status is LISTED, but
 * only `paid` is totalled — rejected and cancelled money never left.
 */
export function expenseRegisterTable(
  data: CashbookReportData,
  range: DateRange,
): ReportTable {
  const rows = data.expenses.filter((e) => inRange(e.expenseDate, range));
  return {
    columns: [
      { label: "Date" },
      { label: "No." },
      { label: "Vendor" },
      { label: "Category" },
      { label: "Invoice" },
      { label: "Mode" },
      { label: "Status" },
      { label: "GST", num: true },
      { label: "Amount", num: true },
    ],
    rows: rows.map((e) => [
      ymdToDMY(e.expenseDate),
      e.expenseNo,
      e.vendorDisplay || "(no vendor)",
      e.categoryPath,
      e.invoiceNo,
      e.paymentMode,
      e.status,
      e.gstAmount,
      e.amount,
    ]),
    totals: [
      "Paid total",
      "",
      "",
      "",
      "",
      "",
      "",
      sum(rows.filter((e) => e.status === "paid").map((e) => e.gstAmount)),
      sum(rows.filter((e) => e.status === "paid").map((e) => e.amount)),
    ],
    empty: "No expenses in this period",
  };
}

/** Paid expenses in range — the shared base for reports 4 and 5. */
const paidExpenses = (data: CashbookReportData, range: DateRange) =>
  data.expenses.filter((e) => inRange(e.expenseDate, range) && e.status === "paid");

// ─── 4. Category-wise Expense Report ────────────────────────────────────────
/** Biggest first: "what are we spending most on" is the question. */
export function categoryBreakdownTable(
  data: CashbookReportData,
  range: DateRange,
): ReportTable {
  const rows = paidExpenses(data, range);
  const total = sum(rows.map((e) => e.amount));
  const groups = new Map<string, { count: number; amount: number }>();
  for (const e of rows) {
    const g = groups.get(e.categoryPath) ?? { count: 0, amount: 0 };
    groups.set(e.categoryPath, {
      count: g.count + 1,
      amount: round2(g.amount + e.amount),
    });
  }
  return {
    columns: [
      { label: "Category" },
      { label: "Count", num: true },
      { label: "Amount", num: true },
      { label: "Share", num: true },
    ],
    rows: [...groups.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, g]) => [name, g.count, g.amount, pct(g.amount, total)]),
    totals: ["Total", rows.length, total, "100.0%"],
    empty: "No expenses in this period",
  };
}

// ─── 5. Vendor-wise Expense Report ──────────────────────────────────────────
export function vendorBreakdownTable(
  data: CashbookReportData,
  range: DateRange,
): ReportTable {
  const rows = paidExpenses(data, range);
  const total = sum(rows.map((e) => e.amount));
  const groups = new Map<string, { count: number; amount: number }>();
  for (const e of rows) {
    // A blank vendor gets a label rather than an anonymous row.
    const key = e.vendorDisplay || "(no vendor)";
    const g = groups.get(key) ?? { count: 0, amount: 0 };
    groups.set(key, { count: g.count + 1, amount: round2(g.amount + e.amount) });
  }
  return {
    columns: [
      { label: "Vendor" },
      { label: "Expenses", num: true },
      { label: "Amount", num: true },
      { label: "Share", num: true },
    ],
    rows: [...groups.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, g]) => [name, g.count, g.amount, pct(g.amount, total)]),
    totals: ["Total", rows.length, total, "100.0%"],
    empty: "No expenses in this period",
  };
}

// ─── 6. Payment Mode Report ─────────────────────────────────────────────────
/** In and out by mode, with the account each mode lands in. Groups by `onDate`. */
export function paymentModeTable(
  data: CashbookReportData,
  range: DateRange,
): ReportTable {
  const rows = data.entries.filter((e) => inRange(e.onDate, range));
  const groups = new Map<string, { account: string; cin: number; cout: number }>();
  for (const e of rows) {
    const g = groups.get(e.paymentMode) ?? {
      account: e.account === "cash" ? "Cash in hand" : "Bank",
      cin: 0,
      cout: 0,
    };
    if (e.direction === "in") g.cin = round2(g.cin + e.amount);
    else g.cout = round2(g.cout + e.amount);
    groups.set(e.paymentMode, g);
  }
  const totalIn = sum(rows.filter((e) => e.direction === "in").map((e) => e.amount));
  const totalOut = sum(rows.filter((e) => e.direction === "out").map((e) => e.amount));
  return {
    columns: [
      { label: "Mode" },
      { label: "Account" },
      { label: "In", num: true },
      { label: "Out", num: true },
      { label: "Net", num: true },
    ],
    rows: [...groups.entries()]
      .sort((a, b) => b[1].cin + b[1].cout - (a[1].cin + a[1].cout))
      .map(([mode, g]) => [mode, g.account, g.cin, g.cout, round2(g.cin - g.cout)]),
    totals: ["Total", "", totalIn, totalOut, round2(totalIn - totalOut)],
    empty: "Nothing moved in this period",
  };
}

// ─── 7. Cash Flow Report ────────────────────────────────────────────────────
export function cashFlowTable(
  data: CashbookReportData,
  range: DateRange,
): ReportTable {
  const rows = data.entries.filter((e) => inRange(e.onDate, range));
  const line = (label: string, account: "cash" | "bank", opening: number) => {
    const own = rows.filter((e) => e.account === account);
    const cin = sum(own.filter((e) => e.direction === "in").map((e) => e.amount));
    const cout = sum(own.filter((e) => e.direction === "out").map((e) => e.amount));
    return [label, opening, cin, cout, round2(opening + cin - cout)];
  };
  const cash = line("Cash in hand", "cash", data.openingCash);
  const bank = line("Bank", "bank", data.openingBank);
  const at = (i: number) => round2((cash[i] as number) + (bank[i] as number));
  return {
    columns: [
      { label: "Account" },
      { label: "Opening", num: true },
      { label: "In", num: true },
      { label: "Out", num: true },
      { label: "Closing", num: true },
    ],
    rows: [cash, bank],
    totals: ["Total", at(1), at(2), at(3), at(4)],
  };
}

// ─── 8. Income vs Expense Report ────────────────────────────────────────────
/**
 * Cash-basis, so it groups by `onDate`.
 *
 * TRANSFERS ARE EXCLUDED from both sides: moving your own money between cash and
 * bank is neither income nor expense, and counting it would inflate both.
 *
 * The gross-profit line appears ONLY when `data.cogs` is non-null, i.e. only for
 * a `dashboard.profit` holder — see `cashbook_cogs` (0053).
 */
export function incomeVsExpenseTables(
  data: CashbookReportData,
  range: DateRange,
): ReportTable[] {
  const real = (e: CashEntry) => e.sourceType !== "transfer";
  const rows = data.entries.filter((e) => inRange(e.onDate, range) && real(e));
  const prev = data.prevEntries.filter(real);

  const side = (dir: "in" | "out"): ReportTable => {
    const own = rows.filter((e) => e.direction === dir);
    const total = sum(own.map((e) => e.amount));
    const groups = new Map<string, number>();
    for (const e of own) {
      groups.set(e.categoryPath, round2((groups.get(e.categoryPath) ?? 0) + e.amount));
    }
    const prevOf = (path: string) =>
      sum(prev.filter((e) => e.direction === dir && e.categoryPath === path).map((e) => e.amount));
    return {
      heading: dir === "in" ? "Income" : "Expense",
      columns: [
        { label: "Category" },
        { label: "Amount", num: true },
        { label: "Share", num: true },
        { label: "vs previous", num: true },
      ],
      rows: [...groups.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([path, amt]) => {
          const before = prevOf(path);
          const delta =
            before === 0 ? "—" : `${round2(((amt - before) / before) * 100).toFixed(1)}%`;
          return [path, amt, pct(amt, total), delta];
        }),
      totals: ["Total", total, "100.0%", ""],
      empty: dir === "in" ? "No income in this period" : "No expenses in this period",
    };
  };

  const income = sum(rows.filter((e) => e.direction === "in").map((e) => e.amount));
  const expense = sum(rows.filter((e) => e.direction === "out").map((e) => e.amount));

  const summaryRows: (string | number)[][] = [
    ["Total income", income],
    ["Total expense", expense],
    ["Net movement", round2(income - expense)],
  ];
  if (data.cogs !== null) {
    summaryRows.push(["Cost of goods sold", data.cogs]);
    summaryRows.push(["Gross profit", round2(income - data.cogs)]);
  }

  return [
    side("in"),
    side("out"),
    {
      heading: "Summary",
      columns: [{ label: "" }, { label: "Amount", num: true }],
      rows: summaryRows,
    },
  ];
}

// ─── 9. Cash Discrepancy Report ─────────────────────────────────────────────
export function discrepancyTable(
  data: CashbookReportData,
  range: DateRange,
): ReportTable {
  const closed = data.days.filter((d) => inRange(d.onDate, range));
  const off = closed
    .filter((d) => d.difference !== 0)
    .sort((a, b) => a.onDate.localeCompare(b.onDate));
  const short = sum(off.filter((d) => d.difference < 0).map((d) => d.difference));
  const excess = sum(off.filter((d) => d.difference > 0).map((d) => d.difference));
  return {
    columns: [
      { label: "Date" },
      { label: "Expected", num: true },
      { label: "Counted", num: true },
      { label: "Difference", num: true },
      { label: "Closed by" },
      { label: "Remarks" },
    ],
    rows: off.map((d) => [
      ymdToDMY(d.onDate),
      d.expectedCash,
      d.countedCash,
      d.difference,
      d.closedByName,
      d.remarks,
    ]),
    // Short and excess are reported SEPARATELY as well as netted: netting alone
    // would report a quiet −250 and hide that 650 moved unexplained.
    totals: [
      `${closed.length} days closed · ${closed.length - off.length} tallied`,
      "",
      "",
      round2(short + excess),
      `short ${short}`,
      `excess ${excess}`,
    ],
    empty: "Every closed day tallied exactly",
  };
}

// ─── Dispatch ───────────────────────────────────────────────────────────────
export function cashbookReportTables(
  type: CashbookReportType,
  data: CashbookReportData,
  range: DateRange,
): ReportTable[] {
  switch (type) {
    case "dayBook":
      return dayBookTables(data, range);
    case "monthlyCash":
      return [monthlyCashTable(data, range)];
    case "expenseRegister":
      return [expenseRegisterTable(data, range)];
    case "categoryBreakdown":
      return [categoryBreakdownTable(data, range)];
    case "vendorBreakdown":
      return [vendorBreakdownTable(data, range)];
    case "paymentMode":
      return [paymentModeTable(data, range)];
    case "cashFlow":
      return [cashFlowTable(data, range)];
    case "incomeVsExpense":
      return incomeVsExpenseTables(data, range);
    case "discrepancy":
      return [discrepancyTable(data, range)];
  }
}

const slugify = (s: string) => (s || "bakery").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Summary lines for the top of a print document, per report. */
function reportSummary(
  type: CashbookReportType,
  data: CashbookReportData,
  range: DateRange,
): { label: string; value: string }[] {
  const c = data.shop.currency;
  const money = (n: number) => `${c}${n.toLocaleString("en-IN")}`;
  const rows = data.entries.filter((e) => inRange(e.onDate, range));
  const cashRows = rows.filter((e) => e.account === "cash");
  const cin = sum(rows.filter((e) => e.direction === "in").map((e) => e.amount));
  const cout = sum(rows.filter((e) => e.direction === "out").map((e) => e.amount));

  switch (type) {
    case "dayBook":
    case "monthlyCash": {
      const closing = round2(data.openingCash + sum(cashRows.map(signed)));
      return [
        { label: "Opening cash", value: money(data.openingCash) },
        { label: "Closing cash", value: money(closing) },
        { label: "Days", value: String(datesOf(cashRows).length) },
      ];
    }
    case "cashFlow": {
      const closing = round2(data.openingCash + data.openingBank + cin - cout);
      return [
        { label: "Opening total", value: money(round2(data.openingCash + data.openingBank)) },
        { label: "In", value: money(cin) },
        { label: "Out", value: money(cout) },
        { label: "Closing total", value: money(closing) },
      ];
    }
    case "incomeVsExpense": {
      const real = rows.filter((e) => e.sourceType !== "transfer");
      const inc = sum(real.filter((e) => e.direction === "in").map((e) => e.amount));
      const exp = sum(real.filter((e) => e.direction === "out").map((e) => e.amount));
      const out = [
        { label: "Income", value: money(inc) },
        { label: "Expense", value: money(exp) },
        { label: "Net", value: money(round2(inc - exp)) },
      ];
      // Only for a dashboard.profit holder — cogs is null otherwise.
      if (data.cogs !== null) {
        out.push({ label: "Gross profit", value: money(round2(inc - data.cogs)) });
      }
      return out;
    }
    case "expenseRegister":
    case "categoryBreakdown":
    case "vendorBreakdown": {
      const paid = paidExpenses(data, range);
      return [
        { label: "Expenses", value: String(paid.length) },
        { label: "Total paid", value: money(sum(paid.map((e) => e.amount))) },
        { label: "GST", value: money(sum(paid.map((e) => e.gstAmount))) },
      ];
    }
    case "paymentMode":
      return [
        { label: "In", value: money(cin) },
        { label: "Out", value: money(cout) },
      ];
    case "discrepancy": {
      const closed = data.days.filter((d) => inRange(d.onDate, range));
      const off = closed.filter((d) => d.difference !== 0);
      return [
        { label: "Days closed", value: String(closed.length) },
        { label: "Tallied", value: String(closed.length - off.length) },
        { label: "Net variance", value: money(sum(off.map((d) => d.difference))) },
      ];
    }
  }
}

/** An A4 print document — `ReportPrintHost` renders it, the browser makes the PDF. */
export function cashbookReport(
  type: CashbookReportType,
  data: CashbookReportData,
  range: DateRange,
): PrintReport {
  const meta = CASHBOOK_REPORT_META[type];
  return {
    kind: "report",
    shop: data.shop.name,
    shopMeta: [data.shop.address, data.shop.phone].filter(Boolean).join(" · "),
    title: meta.name,
    period: rangeLabel(range.from ?? null, range.to ?? null),
    scope: "Cashbook",
    summary: reportSummary(type, data, range),
    tables: cashbookReportTables(type, data, range),
    note: "",
    fileName: `${slugify(data.shop.name)}-${meta.slug}`,
  };
}

/** Excel's hard limit on a worksheet name. */
const SHEET_NAME_MAX = 31;

export function cashbookReportSheets(
  type: CashbookReportType,
  data: CashbookReportData,
  range: DateRange,
): Sheet[] {
  const meta = CASHBOOK_REPORT_META[type];
  const tables = cashbookReportTables(type, data, range);

  return tables.map((t, i) => {
    // A table's own heading names its sheet where it has one (Income / Expense /
    // Summary, or a day-book date); otherwise the report name does.
    const base = t.heading ?? meta.name;
    const name =
      tables.length > 1 ? `${base}`.slice(0, SHEET_NAME_MAX) : base.slice(0, SHEET_NAME_MAX);
    return {
      name: name || `Sheet${i + 1}`,
      rows: [
        // `sheet_add_json` wants objects keyed by the column label.
        ...t.rows.map((r) =>
          Object.fromEntries(t.columns.map((c, j) => [c.label, r[j] ?? ""])),
        ),
        ...(t.totals
          ? [Object.fromEntries(t.columns.map((c, j) => [c.label, t.totals![j] ?? ""]))]
          : []),
      ],
    };
  });
}

/**
 * One report per file. A CSV holds one table, so a multi-table report is
 * concatenated with a blank line and a heading row — readable, and still
 * importable because every section keeps the same delimiter.
 */
export function cashbookReportCsv(
  type: CashbookReportType,
  data: CashbookReportData,
  range: DateRange,
): string {
  const tables = cashbookReportTables(type, data, range);
  const blocks = tables.map((t) => {
    const rows: (string | number)[][] = [];
    if (t.heading) rows.push([t.heading]);
    rows.push(t.columns.map((c) => c.label));
    rows.push(...t.rows);
    if (t.totals) rows.push(t.totals);
    return toCsv(rows);
  });
  return blocks.join("\r\n\r\n");
}
