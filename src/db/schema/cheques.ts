import { pgTable, uuid, text, timestamp, date, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";
import { vendors } from "./purchases";
import { customers } from "./sales";
import { expenses } from "./expenses";
import { payments } from "./payments";

/**
 * A cheque the business has written and handed over. It is a register entry, not a payment: nothing is posted to the ledger until the
 * cheque clears, and then the payment is recorded through the normal payment engine (see src/lib/cheques/cheques.ts), so the books only
 * ever change through the code that already guards them. Its values (payee kind, status) are kept as text and checked where they are
 * saved, so a new choice never needs a migration.
 */
export const issuedCheques = pgTable(
  "issued_cheques",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** The bank account the cheque is drawn on. */
    bankAccountId: uuid("bank_account_id").notNull().references(() => accounts.id),
    chequeNumber: text("cheque_number").notNull(),
    /** "supplier": settles the supplier's ledger (their bills, oldest first, and any excess as an advance). "expense": pays one expense. */
    payeeKind: text("payee_kind").notNull(),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    expenseId: uuid("expense_id").references(() => expenses.id),
    /** The payee's name as it was when the cheque was written, so the register reads right if the supplier is renamed. */
    payeeName: text("payee_name").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    issueDate: date("issue_date").notNull(),
    /** The date written on the cheque: the earliest it can be presented. */
    chequeDate: date("cheque_date").notNull(),
    /** issued | cleared | bounced | stopped */
    status: text("status").notNull().default("issued"),
    clearedDate: date("cleared_date"),
    /** The payment posted when it cleared. */
    paymentId: uuid("payment_id").references(() => payments.id),
    /** Why it was stopped or came back. */
    closedReason: text("closed_reason"),
    /** The earlier cheque this one replaces. */
    replacesId: uuid("replaces_id").references((): AnyPgColumn => issuedCheques.id),
    memo: text("memo"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A cheque number is used once on a bank account, whatever became of the cheque.
    uniqueIndex("issued_cheques_account_number").on(t.tenantId, t.bankAccountId, t.chequeNumber),
    index("issued_cheques_tenant_status").on(t.tenantId, t.status, t.chequeDate),
  ]
);

/**
 * A cheque a customer has handed over, often dated for later. Like an issued cheque it is a register entry, not a receipt: nothing is
 * posted to the ledger until the bank pays it, and then the receipt is recorded through the normal payment engine, which settles the
 * customer's invoices from the oldest. Values (status) are kept as text and checked where they are saved.
 */
export const receivedCheques = pgTable(
  "received_cheques",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    /** The customer's name as it was when the cheque came in. */
    payerName: text("payer_name").notNull(),
    /** The bank the cheque is drawn on (the customer's bank), as written on it. */
    drawerBank: text("drawer_bank").notNull(),
    chequeNumber: text("cheque_number").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    receivedDate: date("received_date").notNull(),
    /** The date written on the cheque: the earliest it can be deposited. */
    chequeDate: date("cheque_date").notNull(),
    /** received (held) | deposited | cleared | bounced | returned */
    status: text("status").notNull().default("received"),
    /** Our bank account it was, or will be, deposited into. */
    depositAccountId: uuid("deposit_account_id").references(() => accounts.id),
    depositedDate: date("deposited_date"),
    clearedDate: date("cleared_date"),
    /** The receipt posted when it cleared. */
    paymentId: uuid("payment_id").references(() => payments.id),
    /** Why it came back or was given back. */
    closedReason: text("closed_reason"),
    memo: text("memo"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same cheque is not entered twice.
    uniqueIndex("received_cheques_unique").on(t.tenantId, t.customerId, t.drawerBank, t.chequeNumber),
    index("received_cheques_tenant_status").on(t.tenantId, t.status, t.chequeDate),
  ]
);
