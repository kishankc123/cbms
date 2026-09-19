import { pgTable, uuid, text, timestamp, date, numeric, boolean, jsonb, integer, pgEnum } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";
import { journalLines } from "./ledger";

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankName: text("bank_name"),
  accountName: text("account_name").notNull(),
  accountNumberMasked: text("account_number_masked"),
  accountNumber: text("account_number"),
  branch: text("branch"),
  currency: text("currency").notNull().default("NPR"),
  chartOfAccountsLink: uuid("chart_of_accounts_link").notNull().references(() => accounts.id),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
});

// A reusable column-mapping template per bank, so a tenant only maps
// columns once per bank rather than on every statement upload.
export const bankStatementTemplates = pgTable("bank_statement_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // { date, description, debit, credit, amount, reference, balance } -> source column header/index
  columnMapping: jsonb("column_mapping").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankStatementImportStatusEnum = pgEnum("bank_statement_import_status", ["draft", "confirmed"]);

export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  fileName: text("file_name"),
  importedFileReference: text("imported_file_reference"),
  importDate: timestamp("import_date", { withTimezone: true }).notNull().defaultNow(),
  statementPeriodStart: date("statement_period_start").notNull(),
  statementPeriodEnd: date("statement_period_end").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  status: bankStatementImportStatusEnum("status").notNull().default("draft"),
});

export const matchStatusEnum = pgEnum("match_status", [
  "unmatched",
  "suggested",
  "matched",
  "ignored",
  "exception",
]);

export const bankStatementLines = pgTable("bank_statement_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  importId: uuid("import_id").notNull().references(() => bankStatementImports.id, { onDelete: "cascade" }),
  transactionDate: date("transaction_date").notNull(),
  description: text("description"),
  reference: text("reference"),
  // Signed: positive = money in (deposit/credit on the bank statement),
  // negative = money out (withdrawal/debit) — normalizes whichever of
  // Debit/Credit/Amount columns the source file used.
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  runningBalance: numeric("running_balance", { precision: 18, scale: 2 }),
  // Hash of date+amount+description+reference — catches the same statement
  // (or an overlapping date range) being imported twice.
  dedupeHash: text("dedupe_hash").notNull(),
  matchStatus: matchStatusEnum("match_status").notNull().default("unmatched"),
});

export const reconciliationMatchTypeEnum = pgEnum("reconciliation_match_type", ["exact", "suggested", "manual"]);

// One reconciliation match can link several statement lines to several
// journal lines (1:1, 1:many, many:1, many:many) — the join tables below
// carry the per-line amount actually applied, supporting partial matches.
export const bankReconciliationMatches = pgTable("bank_reconciliation_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  matchType: reconciliationMatchTypeEnum("match_type").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  unmatchedBy: uuid("unmatched_by").references(() => users.id),
  unmatchedAt: timestamp("unmatched_at", { withTimezone: true }),
});

export const bankReconciliationMatchLines = pgTable("bank_reconciliation_match_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => bankReconciliationMatches.id, { onDelete: "cascade" }),
  statementLineId: uuid("statement_line_id").notNull().references(() => bankStatementLines.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied", { precision: 18, scale: 2 }).notNull(),
});

export const bankReconciliationMatchJournalLines = pgTable("bank_reconciliation_match_journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => bankReconciliationMatches.id, { onDelete: "cascade" }),
  journalLineId: uuid("journal_line_id").notNull().references(() => journalLines.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied", { precision: 18, scale: 2 }).notNull(),
});

export const unmatchedLedgerClassificationEnum = pgEnum("unmatched_ledger_classification", [
  "outstanding_cheque",
  "pending_bank_transaction",
  "not_yet_cleared",
  "timing_difference",
  "incorrect_transaction",
]);

// Lets a user record why a posted ledger transaction isn't in the bank
// statement yet, without needing to match or alter it.
export const unmatchedLedgerClassifications = pgTable("unmatched_ledger_classifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  journalLineId: uuid("journal_line_id").notNull().references(() => journalLines.id, { onDelete: "cascade" }),
  classification: unmatchedLedgerClassificationEnum("classification").notNull(),
  notes: text("notes"),
  classifiedBy: uuid("classified_by").notNull().references(() => users.id),
  classifiedAt: timestamp("classified_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliationStatusEnum = pgEnum("reconciliation_status", ["in_progress", "reconciled", "reopened"]);

// One row per completed (or in-progress) reconciliation session for a bank
// account and period — "Mark Reconciled" writes this; reopening updates it
// and is itself recorded (who/when/reason), never silently overwritten.
export const bankReconciliations = pgTable("bank_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  statementBalance: numeric("statement_balance", { precision: 18, scale: 2 }).notNull(),
  ledgerBalance: numeric("ledger_balance", { precision: 18, scale: 2 }).notNull(),
  status: reconciliationStatusEnum("status").notNull().default("in_progress"),
  reconciledBy: uuid("reconciled_by").references(() => users.id),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => users.id),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenReason: text("reopen_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
