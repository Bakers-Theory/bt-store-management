/**
 * The granular permission catalogue. Mirrored by `has_perm()` in SQL — the SQL
 * copy is the actual enforcement; this one only decides what the UI renders.
 *
 * Clearing all data and the admin audit trail are deliberately absent: they are
 * Owner-only and never grantable, so they have no key to hand out.
 */
export type PermissionKey =
  // Dashboard
  | "dashboard.view"
  | "dashboard.profit"
  // Billing
  | "bill.create"
  | "bill.discount"
  | "bill.print"
  | "bill.cancel"
  | "bill.delete"
  | "bill.history"
  // Inventory
  | "stock.view"
  | "stock.in"
  | "stock.out"
  | "stock.expiry"
  | "items.create"
  | "items.edit"
  | "items.delete"
  | "items.cost"
  // Customers
  | "customers.view"
  | "customers.edit"
  // Reports
  | "reports.view"
  | "reports.export"
  // Attendance
  | "attendance.view"
  | "attendance.edit"
  // Salary
  | "salary.view"
  | "salary.edit"
  | "salary.pay"
  // Advances
  | "advance.view"
  | "advance.request"
  | "advance.approve"
  | "advance.delete"
  // Suppliers & Purchasing
  | "suppliers.view"
  | "suppliers.create"
  | "suppliers.edit"
  | "suppliers.status"
  | "purchases.create"
  | "purchases.pay"
  | "purchases.return"
  | "suppliers.financial"
  | "suppliers.reports"
  // Cashbook
  | "cashbook.view"
  | "cashbook.entry"
  | "cashbook.close"
  | "cashbook.reopen"
  | "cashbook.reports"
  // Expenses
  | "expense.view"
  | "expense.create"
  | "expense.pay"
  | "expense.cancel"
  // Store admin
  | "store.settings"
  | "store.status"
  | "store.lists"
  | "staff.manage"
  | "activity.view";

export interface Bakery {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  gst: string;
  logo: string | null; // base64 data URL
  currency: string;
  taxRate: number;
  lowStockAlert: number;
  expiringSoonDays: number;
  isOpen: boolean;
  statusChangedAt: string | null; // ISO, null until the first toggle
  statusChangedBy: string; // name of the user who last changed status ("" if never)
}

export interface Item {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string | null; // uploaded product image URL; null = use emoji
  category: string;
  unit: string;
  price: number; // selling price
  costPrice: number; // bought price (private)
  qty: number;
  tracksExpiry: boolean;
  earliestExpiry: string | null; // "YYYY-MM-DD" of soonest in-stock batch, or null
  // In-stock batches (qty > 0), soonest-expiry-first. Includes expired batches;
  // the bill page filters those out locally to sell/show only fresh stock.
  batches: { qty: number; expiryDate: string | null }[];
}

export interface Batch {
  id: string;
  itemId: string;
  qty: number;
  expiryDate: string | null; // "YYYY-MM-DD" or null (never expires)
  createdAt: string; // ISO
  /**
   * Which delivery this batch came from, stamped by `post_purchase_invoice`
   * (migration 0040). Null on batches that predate that migration and on any
   * stock added through the Stock In form or a bill cancellation — those have no
   * invoice behind them.
   *
   * `supplierId` is present even when `supplierName` is withheld, which is how
   * "no source recorded" is told apart from "source hidden from this user"
   * (the name needs `suppliers.view`).
   */
  supplierId: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  /** The invoice number, or the `IH-` reference for in-house production. */
  sourceRef: string | null;
}

export interface BillLine {
  itemId: string;
  name: string;
  emoji: string;
  imageUrl: string | null; // snapshot of the item's image at bill time
  unit: string;
  qty: number;
  price: number;
  costPrice: number;
}

export type BillStatus = "active" | "cancelled";

export type PaymentMethod = "Cash" | "UPI";

export interface Customer {
  id: string;
  phone: string;
  name: string;
  firstSeen: string; // ISO
  visitCount: number;
  totalSpend: number;
  lastPurchase: string | null; // ISO or null if no active bills
}

export interface Bill {
  id: string;
  billNo: number;
  customerId?: string; // FK to customers.id (null for legacy pre-feature bills)
  customerName: string;
  customerPhone: string;
  items: BillLine[];
  subtotal: number;
  tax: number;
  total: number;
  taxRate: number;
  paymentMethod: PaymentMethod;
  discountPercent: number;
  discountType: "percent" | "flat";
  discountAmount: number; // actual money discounted (₹), for percent and flat alike
  /** Unrecoverable gap when the customer paid less than `total` (0 = paid in full). */
  shortfall: number;
  /** Optional reason the biller gave for the shortfall ("" when none). */
  shortfallNote: string;
  billerName: string; // name of the user who generated the bill ("" for legacy bills)
  date: string; // ISO
  status: BillStatus;
  cancelledAt?: string;
  cancelledBy?: string;
}

export type LogType =
  | "in"
  | "out"
  | "bill"
  | "cancel"
  | "delete"
  | "open"
  | "close"
  | "settings"
  | "staff_add"
  | "staff_edit"
  | "staff_remove"
  | "password";

export interface Log {
  id: string;
  type: LogType;
  date: string; // ISO
  // stock movements
  itemId?: string;
  itemName?: string;
  qty?: number;
  supplier?: string;
  reason?: string;
  notes?: string;
  // bill events
  billNo?: number;
  items?: string; // comma-joined item names
  total?: number;
  // who performed the operation
  user?: string;
}

/**
 * The stored role stays a two-value flag: `Owner` is unique (partial unique
 * index) and implicitly holds every permission; everyone else is `Staff`.
 *
 * Admin / Manager / Cashier / Storekeeper are **presets, not stored roles** —
 * choosing one stamps its permission set into `User.permissions`, which is the
 * only thing ever enforced. The badge a staff member displays is *derived* from
 * their set (`presetForPerms`), so a stored label can never disagree with what
 * they can actually do.
 */
export type UserRole = "Owner" | "Staff";

export type PresetRole = "Admin" | "Manager" | "Cashier" | "Storekeeper";

/** What the UI shows as someone's role. Derived, never stored. */
export type RoleLabel = "Owner" | PresetRole | "Custom" | "No access";

/** One widget's position/width within the dashboard grid. */
export interface DashboardWidgetSlot {
  id: string;
  span: number;
  /** 1-based index into the widget's `heightLevels` (registry, dashboard-layout.ts).
   *  Only meaningful for widgets that declare `heightLevels`; omitted/ignored otherwise. */
  heightLevel?: number;
}

/**
 * A user's saved dashboard layout. `visible` is what's rendered, in order.
 * `dismissed` holds widgets the user explicitly removed — kept separate from
 * "just not in visible" so a removed default-visible widget doesn't silently
 * reappear the moment a new widget ships or a permission changes. See
 * docs/superpowers/specs/2026-08-01-dashboard-customizable-layout-design.md.
 */
export interface StoredLayout {
  visible: DashboardWidgetSlot[];
  dismissed: DashboardWidgetSlot[];
}
export interface User {
  id: string;
  name: string;
  userId: string;
  role: UserRole;
  /** Granular grants. Empty for the Owner, who bypasses the check entirely. */
  permissions: PermissionKey[];
  /** null = use the default layout. */
  dashboardLayout: StoredLayout | null;
}

/**
 * Statuses an employee's day can be recorded as.
 *
 * There is no "absent": every day is one of these four. Time off is recorded as
 * Leave, which is unpaid. An unmarked day is therefore data not yet entered — not
 * an absence — and never costs anyone money.
 */
export type AttendanceStatus = "present" | "half_day" | "leave" | "holiday";

export interface Attendance {
  id: string;
  profileId: string;
  employeeName: string;
  date: string; // "YYYY-MM-DD"
  status: AttendanceStatus;
  note: string;
  markedByName: string; // "" when the marker's account was since removed
  updatedAt: string; // ISO
}

/** One employee's status tallies over a date range, computed server-side. */
export interface AttendanceSummary {
  profileId: string;
  employeeName: string;
  present: number;
  halfDay: number;
  leave: number;
  holiday: number;
  recorded: number;
  /** Days that earn pay: Present/Holiday = 1, Half Day = 0.5, Leave = 0. */
  payableDays: number;
  /**
   * Days deducted from a fixed monthly salary: Leave = 1, Half Day = 0.5.
   * This — not `payableDays` — is what payroll bills against, because
   * unrecorded days must not deduct.
   */
  unpaidDays: number;
}

/**
 * A person attendance can be recorded against: a `profiles` row, name only.
 * The Owner is excluded — they're the proprietor, not an employee — so there is
 * no role to carry here.
 */
export interface Employee {
  id: string;
  name: string;
}

// ─── Salary ─────────────────────────────────────────────────────────────────

export type PaymentStatus = "unpaid" | "paid";

/** How a salary was handed over. Wider than a bill's `PaymentMethod`. */
export type SalaryMode = "Cash" | "UPI"

export interface EmployeeSalary {
  profileId: string;
  employeeName: string;
  monthlySalary: number;
  updatedAt: string | null; // null until a salary is first set
}

/** One employee's payroll for one month, as computed from live attendance. */
export interface PayrollRow {
  profileId: string;
  employeeName: string;
  gross: number;
  calendarDays: number;
  /** Attendance rows present for the month — `calendarDays - recorded` is the gap. */
  recorded: number;
  unpaidDays: number;
  deduction: number;
  computedNet: number;
  /** Null until a payroll record exists for the period. */
  paymentId: string | null;
  status: PaymentStatus | "none";
  /** The filed figure, which may differ from `computedNet`. */
  net: number | null;
  /**
   * What the calculation said when the record was prepared. It differs from
   * `computedNet` only when attendance moved afterwards — which is how a stale
   * record is told apart from a deliberately adjusted one. Null before a record
   * exists.
   */
  storedComputedNet: number | null;
  overrideReason: string;
  paidOn: string | null;
  paymentMode: SalaryMode | "";
  /** Outstanding advance balance, excluding this record's own recovery. */
  advanceBalance: number;
  /** Recovery set on this period's record; 0 when no record exists. */
  advanceRecovery: number;
  /** `net − advanceRecovery` — what is actually handed over. */
  netPayable: number;
}

export interface SalaryPayment {
  id: string;
  profileId: string;
  employeeName: string;
  periodYear: number;
  periodMonth: number;
  gross: number;
  calendarDays: number;
  /** Null for records filed before this was snapshotted — i.e. unknown. */
  recordedDays: number | null;
  unpaidDays: number;
  deduction: number;
  computedNet: number;
  net: number;
  overrideReason: string;
  status: PaymentStatus;
  paidOn: string | null;
  paymentMode: SalaryMode | "";
  recordedByName: string;
  updatedAt: string;
  advanceRecovery: number;
  netPayable: number;
}

export interface StoreLists {
  categories: string[];
  emojis: string[];
  units: string[];
  reasons: string[];
}

// ─── Advances ───────────────────────────────────────────────────────────────

export type AdvanceStatus = "pending" | "approved" | "rejected";

/** One advance request, at whatever stage it has reached. */
export interface StaffAdvance {
  id: string;
  profileId: string;
  employeeName: string;
  amount: number;
  note: string;
  status: AdvanceStatus;
  requestedOn: string;
  requestedByName: string;
  /** Null until approved. Approval and disbursement are one step. */
  approvedOn: string | null;
  paymentMode: SalaryMode | "";
  rejectReason: string;
  decidedByName: string;
  updatedAt: string;
}

/**
 * One employee's advance position. `balance` is "still owed after everything
 * prepared" — recoveries on unpaid payroll records are already subtracted, so
 * the same money is never suggested for recovery twice.
 */
export interface AdvanceBalance {
  profileId: string;
  employeeName: string;
  totalAdvanced: number;
  totalRecovered: number;
  balance: number;
  pendingAmount: number;
  /** Earliest approved advance while anything is outstanding, else null. */
  oldestOpen: string | null;
  monthlySalary: number;
}

// ─── Suppliers ──────────────────────────────────────────────────────────────

/**
 * `in_house` is the store's own production: it carries cost, but no invoice
 * number, no GST and no payable. It is a supplier *type* rather than a separate
 * system so product association, history and cost tracking stay on one path.
 */
export type SupplierType = "external" | "in_house";

export type SupplierStatus = "active" | "inactive";

export interface Supplier {
  id: string;
  /** `SUP-0001`, from `supplier_code_seq`. Unique, human-quotable. */
  code: string;
  supplierType: SupplierType;
  name: string;
  businessName: string;
  contactPerson: string;
  mobile: string;
  email: string;
  /** Never required. Forbidden outright on in-house suppliers. */
  gstin: string;
  address: string;
  city: string;
  state: string;
  pinCode: string;
  paymentTerms: string;
  notes: string;
  status: SupplierStatus;
  createdAt: string; // ISO
  /** Powers the optimistic version check on update. */
  updatedAt: string; // ISO
}

/**
 * One product a supplier supplies (FR-10). Every figure below the item's own
 * fields is derived from posted invoice lines, so nothing here can be stale.
 *
 * There is no SKU: `public.items` has no such column. Category and unit
 * identify the product instead.
 */
export interface SupplierProduct {
  supplierId: string;
  itemId: string;
  itemName: string;
  emoji: string;
  imageUrl: string | null;
  category: string;
  unit: string;
  currentQty: number;
  earliestExpiry: string | null; // "YYYY-MM-DD"
  /** Latest posted unit cost from THIS supplier. Null before any purchase. */
  lastUnitCost: number | null;
  /** Latest posted purchase date from this supplier. Null before any purchase. */
  lastPurchaseDate: string | null;
  linkedAt: string; // ISO
}

// ─── Purchasing ─────────────────────────────────────────────────────────────

/**
 * How a supplier was paid. Wider than a bill's `PaymentMethod` and wider than
 * `SalaryMode`: trade payables are routinely settled by bank transfer or
 * cheque, neither of which is a way a customer or an employee is ever paid.
 */
export type PurchaseMode = "Cash" | "UPI" | "Bank Transfer" | "Cheque";

/** Only `posted` invoices touch stock or any financial aggregate. */
export type InvoiceStatus = "draft" | "posted" | "cancelled";

export interface PurchaseInvoiceLine {
  id: string;
  itemId: string;
  itemName: string;
  qty: number;
  unitCost: number;
  /** Percent. Always 0 on an in-house receipt. */
  gstRate: number;
  lineTotal: number;
  expiry: string | null; // "YYYY-MM-DD"
  /** Already credited back on posted returns, so the UI can cap a new one. */
  returnedQty: number;
}

export interface PurchaseInvoice {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  supplierType: SupplierType;
  /** The supplier's own number. Null on in-house receipts. */
  invoiceNo: string | null;
  /** `IH-0001`. Null on external invoices. */
  internalRef: string | null;
  purchaseDate: string; // "YYYY-MM-DD"
  subtotal: number;
  /** Null on in-house receipts — a database guarantee, not a UI convention. */
  gstAmount: number | null;
  total: number;
  status: InvoiceStatus;
  notes: string;
  createdByName: string;
  createdAt: string; // ISO
  lines: PurchaseInvoiceLine[];
  /** Set by `cancel_purchase_invoice` (migration 0043) when one is withdrawn. */
  cancelledAt: string | null;
  cancelReason: string;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  /** Optional: a payment may settle one invoice or sit on account. */
  invoiceId: string | null;
  invoiceNo: string | null;
  amount: number;
  paidOn: string; // "YYYY-MM-DD"
  mode: PurchaseMode;
  referenceNo: string;
  createdByName: string;
  createdAt: string; // ISO
}

export interface PurchaseReturnLine {
  id: string;
  invoiceLineId: string;
  itemId: string;
  itemName: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseReturn {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceId: string;
  invoiceNo: string | null;
  returnDate: string; // "YYYY-MM-DD"
  total: number;
  status: InvoiceStatus;
  reason: string;
  createdByName: string;
  createdAt: string; // ISO
  lines: PurchaseReturnLine[];
  /** Set by `cancel_purchase_return` (migration 0041) when a credit note is withdrawn. */
  cancelledAt: string | null;
  cancelReason: string;
}

/**
 * One supplier's account position (FR-16), computed live from posted rows.
 * There is no stored balance column anywhere, so nothing can fall out of sync.
 *
 * Money fields read 0 for a caller without `suppliers.financial` — the view
 * nulls them at the column level and the mapper coalesces.
 */
export interface SupplierSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  supplierType: SupplierType;
  /** External only. In-house receipts are never a payable. */
  totalPurchases: number;
  totalPayments: number;
  returnCredit: number;
  outstanding: number;
  /** In-house only: what your own production has cost. Reported separately. */
  inHouseValue: number;
  lastTransactionDate: string | null;
  lastPaymentDate: string | null;
  /** An invoice IS the order record; there is no separate PO entity. */
  purchaseOrderCount: number;
  transactionCount: number;
}

// ─── Cashbook ───────────────────────────────────────────────────────────────

/** The two accounts the cashbook tracks. Physical drawer, and the bank. */
export type CashAccount = "cash" | "bank";

export type CashDirection = "in" | "out";

/**
 * Modes a posting can carry. `Cheque` exists only to read historical
 * `supplier_payment` rows (0038) — no form offers it. `Mixed` is not here:
 * a mixed payment is two entries, each with its own real mode.
 */
export type CashPaymentMode = "Cash" | "UPI" | "Bank Transfer" | "Cheque";

export type CashSourceType =
  | "bill"
  | "expense"
  | "salary"
  | "advance"
  | "supplier_payment"
  | "manual"
  | "transfer"
  | "opening";

/** Derived in `cash_entry_v`, never stored — a posting either happened or it didn't. */
export type CashEntryStatus = "posted" | "reversed" | "reversal";

export interface CashEntry {
  id: string;
  onDate: string; // "YYYY-MM-DD" — the local business date
  createdAt: string; // ISO instant, gives the Time column
  account: CashAccount;
  direction: CashDirection;
  amount: number;
  paymentMode: CashPaymentMode;
  categoryId: string;
  categoryName: string;
  categoryGroup: string; // "" for a top-level (system) category
  categoryPath: string; // "Utilities › Rent", or just "Sales"
  sourceType: CashSourceType;
  sourceId: string | null;
  sourceRef: string; // "#412", an employee name, a supplier name, or ""
  reversesId: string | null;
  transferId: string | null;
  referenceNo: string;
  note: string;
  // The id, not just the name: two staff can share a name, and "is this mine?"
  // decides whether the edit button renders.
  createdById: string | null;
  createdByName: string;
  status: CashEntryStatus;
  runningBalance: number; // computed by cash_entry_v over the whole ledger
}

export interface CashCategory {
  id: string;
  parentId: string | null;
  name: string;
  direction: "in" | "out" | "both";
  isSystem: boolean;
  sortOrder: number;
}

export type CashDayStatus = "open" | "closed";

/**
 * A day that has been closed at least once. A date with NO row is open — the
 * same "absence is data, not a state" rule `attendance` uses.
 */
export interface CashDay {
  onDate: string; // "YYYY-MM-DD"
  openingCash: number;
  expectedCash: number;
  countedCash: number;
  /** counted − expected. Negative is short, positive is excess. */
  difference: number;
  /**
   * The bank side (migration 0050). Null on every day closed before it existed,
   * and on any day closed without reading a balance off the bank — "not
   * checked", which is different from "checked and it was zero".
   */
  openingBank: number | null;
  expectedBank: number | null;
  closingBank: number | null;
  /** closingBank − expectedBank. Null whenever either side is. */
  bankDifference: number | null;
  remarks: string;
  status: CashDayStatus;
  closedByName: string;
  closedAt: string | null;
  reopenedByName: string;
  reopenedAt: string | null;
  reopenReason: string;
}

/**
 * Two kinds of figure, deliberately. The balances are point-in-time and ignore
 * the filter range — "cash in hand" is what is in the drawer now. The `period*`
 * figures follow the range, so the tiles and the transaction list below them
 * always describe the same slice of time.
 */
export interface CashbookSummary {
  cashBalance: number;
  bankBalance: number;
  periodSales: number;
  periodExpenses: number;
  periodCashIn: number;
  periodCashOut: number;
}

/**
 * The reconciliation figures for one day, from `cash_day_summary(date)`.
 * Deliberately separate from `CashbookSummary`, which summarises a user-chosen
 * date RANGE and has no single day to reconcile against.
 */
export interface CashDaySummary {
  onDate: string; // "YYYY-MM-DD"
  /** The ledger's cash balance strictly before `onDate`. */
  openingCash: number;
  /** openingCash + the day's cash movements. */
  expectedCash: number;
  cashIn: number;
  cashOut: number;
  /** Null until the day has been closed. */
  countedCash: number | null;
  /** The ledger's bank balance strictly before `onDate`. */
  openingBank: number;
  /** openingBank + the day's bank movements — what the book says the bank holds. */
  expectedBank: number;
  bankIn: number;
  bankOut: number;
  /** The balance read off the bank. Null means it was never checked. */
  closingBank: number | null;
  status: CashDayStatus;
}

export interface CashEntryFilters {
  from?: string;
  to?: string;
  account?: CashAccount;
  direction?: CashDirection;
  categoryId?: string;
  paymentMode?: CashPaymentMode;
  sourceType?: CashSourceType;
  q?: string;
}

// ─── Expenses ───────────────────────────────────────────────────────────────

/**
 * Four states, not #32's six. `draft` and `approved` are deliberately absent:
 * an "approved but unpaid" expense IS a payable, and suppliers already own
 * payables in this app.
 */
export type ExpenseStatus = "pending" | "paid" | "rejected" | "cancelled";

/** `Mixed` means part cash, part bank — two ledger rows, one document. */
export type ExpenseMode = "Cash" | "UPI" | "Bank Transfer" | "Mixed";

/** The bank leg of a Mixed payment. The cash leg is always `Cash`. */
export type ExpenseBankMode = "UPI" | "Bank Transfer";

export interface Expense {
  id: string;
  expenseNo: number;
  /** When the cost was incurred. Reports group by this. */
  expenseDate: string; // "YYYY-MM-DD"
  /** When cash actually moved. The LEDGER uses this. Null until paid. */
  paidOn: string | null;
  categoryId: string;
  categoryName: string;
  categoryGroup: string;
  categoryPath: string;
  vendorName: string;
  /** Informational only — NEVER affects `supplier_summary_v`. */
  vendorSupplierId: string | null;
  /** The linked supplier's name when linked, else `vendorName`. */
  vendorDisplay: string;
  /** Gross, GST-inclusive. This is what posts to cash. */
  amount: number;
  gstIncluded: boolean;
  /** The tax component within `amount`, not on top of it. */
  gstAmount: number;
  paymentMode: ExpenseMode;
  splitCash: number;
  splitBank: number;
  splitBankMode: ExpenseBankMode | "";
  invoiceNo: string;
  description: string;
  paidByName: string;
  approvedByName: string;
  status: ExpenseStatus;
  rejectReason: string;
  cancelReason: string;
  createdById: string | null;
  createdByName: string;
  createdAt: string;
  updatedByName: string;
  updatedAt: string;
}

export type ExpenseEventKind =
  | "created"
  | "edited"
  | "approved"
  | "rejected"
  | "paid"
  | "cancelled"
  | "deleted";

export interface ExpenseEvent {
  id: string;
  expenseId: string;
  event: ExpenseEventKind;
  actorName: string;
  at: string;
  /** Field-level diff for `edited`, the reason text for `rejected`/`cancelled`. */
  detail: Record<string, unknown>;
}

export interface ExpenseInput {
  id?: string;
  expenseDate: string;
  categoryId: string;
  vendorName: string;
  vendorSupplierId: string | null;
  amount: number;
  gstIncluded: boolean;
  gstAmount: number;
  paymentMode: ExpenseMode;
  splitCash: number;
  splitBank: number;
  splitBankMode: ExpenseBankMode | "";
  invoiceNo: string;
  description: string;
  /** Empty means "me". */
  paidById: string;
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  vendor?: string;
  minAmount?: number;
  maxAmount?: number;
  paymentMode?: ExpenseMode;
  status?: ExpenseStatus;
  paidById?: string;
  q?: string;
}
