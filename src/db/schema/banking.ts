import { pgTable, uuid, text, timestamp, date, numeric, pgEnum } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";
import { journalLines } from "./ledger";

export const matchStatusEnum = pgEnum("match_status", [
  "unmatched",
  "auto_matched",
  "manually_matched",
  "ignored",
]);

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  accountName: text("account_name").notNull(),
  accountNumberMasked: text("account_number_masked"),
  currency: text("currency").notNull().default("NPR"),
  chartOfAccountsLink: uuid("chart_of_accounts_link").notNull().references(() => accounts.id),
});

export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  importedFileReference: text("imported_file_reference"),
  importDate: timestamp("import_date", { withTimezone: true }).notNull().defaultNow(),
  statementPeriodStart: date("statement_period_start").notNull(),
  statementPeriodEnd: date("statement_period_end").notNull(),
});

export const bankStatementLines = pgTable("bank_statement_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => bankStatementImports.id, { onDelete: "cascade" }),
  transactionDate: date("transaction_date").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  matchedJournalLineId: uuid("matched_journal_line_id").references(() => journalLines.id),
  matchStatus: matchStatusEnum("match_status").notNull().default("unmatched"),
});
