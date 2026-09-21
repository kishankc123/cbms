import { pgTable, uuid, text, timestamp, date, numeric, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";
import { customers } from "./sales";
import { vendors } from "./purchases";
import { employees } from "./payroll";
import { journalEntries } from "./ledger";

// Unified Payment module — the single source of truth for every money
// movement into or out of the business (spec: "Payment module records the
// settlement of money"). Both "money in" (customer receipts, advances,
// loans, capital, refunds, other) and "money out" (supplier/expense/tax
// payments, loan repayments, advances, owner withdrawals, transfers, other)
// live in one table so they can be listed, filtered, and reconciled
// together with one numbering scheme.
export const paymentDirectionEnum = pgEnum("payment_direction", ["money_in", "money_out"]);

export const paymentTypeEnum = pgEnum("payment_type", [
  // Money in
  "customer_payment",
  "customer_advance",
  "loan_received",
  "capital_introduced",
  "refund_received",
  "other_receipt",
  // Money out
  "supplier_payment",
  "customer_refund",
  "expense_payment",
  "tax_payment",
  "loan_repayment",
  "supplier_advance",
  "owner_withdrawal",
  "cash_withdrawal",
  "bank_transfer",
  "other_payment",
]);

export const paymentPartyTypeEnum = pgEnum("payment_party_type", ["customer", "supplier", "employee", "other", "none"]);

export const paymentMethodEnum = pgEnum("payment_method", ["cash", "bank_transfer", "cheque", "card", "online", "other"]);

export const paymentStatusEnum = pgEnum("payment_status", ["draft", "posted", "voided"]);

// "embedded" = auto-recorded by Sales/Purchases' own invoice/bill entry
// screens (paid-at-creation) — shown in this module's list for visibility,
// but voided/edited only by voiding/editing the source invoice or bill.
// "standalone" = created directly through this module's own "+ New Payment"
// flow (including a later payment against an already-existing invoice/bill,
// and every type with no other home) — fully voidable here.
export const paymentOriginEnum = pgEnum("payment_origin", ["standalone", "embedded"]);

export const paymentAllocationTargetEnum = pgEnum("payment_allocation_target", ["sales_invoice", "purchase_bill", "expense", "tax_obligation"]);

export const payments = pgTable("payments_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),

  paymentNumber: text("payment_number").notNull(),
  direction: paymentDirectionEnum("direction").notNull(),
  paymentType: paymentTypeEnum("payment_type").notNull(),
  paymentDate: date("payment_date").notNull(),

  partyType: paymentPartyTypeEnum("party_type").notNull().default("none"),
  customerId: uuid("customer_id").references(() => customers.id),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  employeeId: uuid("employee_id").references(() => employees.id),
  partyOtherName: text("party_other_name"),

  // The cash/bank chart account the money actually moved into/out of. For a
  // transfer or cash withdrawal, this is the "from" leg and
  // transferToAccountId is the "to" leg.
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  transferToAccountId: uuid("transfer_to_account_id").references(() => accounts.id),
  // Classification account for types with no dedicated control account
  // (Other Receipt/Payment, Tax Payment's choice of liability, a refund's
  // unallocated remainder) — never left to default silently, see spec
  // section 12 "must not bypass required accounting classification".
  categoryAccountId: uuid("category_account_id").references(() => accounts.id),

  paymentMethod: paymentMethodEnum("payment_method").notNull().default("cash"),
  chequeNumber: text("cheque_number"),
  chequeDate: date("cheque_date"),
  chequeBank: text("cheque_bank"),
  referenceNumber: text("reference_number"),

  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  description: text("description"),
  notes: text("notes"),
  // Lightweight reference only (URL/filename a user pastes in) — this app has
  // no file-storage backend yet, so this is not a real upload.
  attachmentUrl: text("attachment_url"),

  status: paymentStatusEnum("status").notNull().default("posted"),
  origin: paymentOriginEnum("origin").notNull().default("standalone"),
  // The journal entry this payment posted — kept for the life of the row so
  // the detail page and reconciliation lookups have a direct pointer instead
  // of searching by sourceType/sourceId.
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),

  voidReason: text("void_reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  postedBy: uuid("posted_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  voidedBy: uuid("voided_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
}, (t) => [uniqueIndex("payments_tenant_number").on(t.tenantId, t.paymentNumber)]);

// One payment can settle multiple invoices/bills (or a single expense) —
// see spec section 17 "Multiple Invoice Payment". allocatedAmount for a
// customer/supplier payment never exceeds the payment's own amount; any
// unallocated remainder is booked to that party's Advance account instead
// (see src/lib/ledger/advance-accounts.ts), not left dangling.
export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  targetType: paymentAllocationTargetEnum("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  allocatedAmount: numeric("allocated_amount", { precision: 18, scale: 2 }).notNull(),
});

// A sales return (credit due to the customer) or purchase return (credit due from the supplier) applied against
// an invoice / bill. It changes what is still owed on that document; the ledger already reflects the return itself,
// so no journal entry is posted here.
export const creditApplications = pgTable(
  "credit_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"sales_return" | "purchase_return">().notNull(),
    returnId: uuid("return_id").notNull(),
    targetId: uuid("target_id").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    status: text("status").$type<"applied" | "reversed">().notNull().default("applied"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_applications_return").on(t.tenantId, t.returnId), index("credit_applications_target").on(t.tenantId, t.targetId)]
);

// An advance (money received from a customer, or paid to a supplier, ahead of a document) applied to an invoice or
// bill. Unlike a return's credit this moves money between accounts, so it carries its journal entry: for a customer
// Dr their Advance account / Cr their receivable account; for a supplier Dr their payable account / Cr their Advance.
export const advanceApplications = pgTable(
  "advance_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    side: text("side").$type<"customer" | "supplier">().notNull(),
    partyId: uuid("party_id").notNull(),
    targetId: uuid("target_id").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    status: text("status").$type<"applied" | "reversed">().notNull().default("applied"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("advance_applications_target").on(t.tenantId, t.targetId), index("advance_applications_party").on(t.tenantId, t.partyId)]
);
