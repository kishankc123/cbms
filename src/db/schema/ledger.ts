import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  boolean,
  numeric,
  pgEnum,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";

export const journalSourceTypeEnum = pgEnum("journal_source_type", [
  "sale",
  "purchase",
  "expense",
  "payment",
  "receipt",
  "bank_adjustment",
  "manual",
]);

// The ledger core. Every financial event produces one of these. Never hard-deleted —
// corrections are made via a reversing entry referencing reversalOfId.
export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  entryDate: date("entry_date").notNull(),
  referenceNumber: text("reference_number"),
  sourceType: journalSourceTypeEnum("source_type").notNull(),
  sourceId: uuid("source_id"),
  memo: text("memo"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  isReversed: boolean("is_reversed").notNull().default(false),
  reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => journalEntries.id),
});

// SUM(debitAmount) must equal SUM(creditAmount) for a given journalEntryId.
// Enforced in the posting service (see src/lib/ledger/post.ts), not just at the DB layer,
// because it's a cross-row invariant.
export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalEntryId: uuid("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  debitAmount: numeric("debit_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  creditAmount: numeric("credit_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  description: text("description"),
});
