import { pgTable, uuid, text, timestamp, date, numeric, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";
import { journalEntries } from "./ledger";

export const interTransferStatusEnum = pgEnum("inter_transfer_status", ["posted", "voided"]);

// Movement of money between the business's own Cash/Bank accounts. Never
// touches P&L — its journal entry is always exactly Dr destination / Cr
// source. journalEntryId always points at the entry currently in force
// (an edit reverses the old entry and re-points this at the new one).
export const interTransfers = pgTable(
  "inter_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    transferNumber: text("transfer_number").notNull(),
    transferDate: date("transfer_date").notNull(),
    fromAccountId: uuid("from_account_id").notNull().references(() => accounts.id),
    toAccountId: uuid("to_account_id").notNull().references(() => accounts.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    reference: text("reference"),
    description: text("description"),
    // Reference only (URL/filename) — the app has no file-storage backend.
    attachmentUrl: text("attachment_url"),
    status: interTransferStatusEnum("status").notNull().default("posted"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    voidedBy: uuid("voided_by"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inter_transfers_tenant_number_idx").on(t.tenantId, t.transferNumber)]
);
