import { pgTable, uuid, text, date, numeric, timestamp, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";
import { bankAccounts } from "./banking";
import { expenses } from "./expenses";
import { journalEntries, journalLines, daybookCashCounts } from "./ledger";

// Reconciling a cash account against the cash that is really there. The person ticks the entries they have checked; the opening balance is the last
// reconciliation's closing; a count (the Daybook's cash count) is the proof, and is optional. A short or excess found at the count can be posted to the
// Cash short and excess account, and explained later by an expense (or an unrecorded receipt) that moves it out of that account.

export const cashReconciliations = pgTable(
  "cash_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
    /** The ledger account of that cash account, kept so the history survives a change to the link. */
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    asOfDate: date("as_of_date").notNull(),
    /** The date of the latest entry this reconciliation took in: what the account is really reconciled up to. (asOfDate is only the cut-off picked on the screen.) */
    throughDate: date("through_date").notNull(),
    opening: numeric("opening", { precision: 18, scale: 2 }).notNull(),
    tickedIn: numeric("ticked_in", { precision: 18, scale: 2 }).notNull().default("0"),
    tickedOut: numeric("ticked_out", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Counted minus the books before any adjustment (negative = short). Null when nothing was counted. */
    difference: numeric("difference", { precision: 18, scale: 2 }),
    /** What was posted to Cash short and excess to make the books agree with the count (negative = a short). 0 when nothing was posted. */
    adjustment: numeric("adjustment", { precision: 18, scale: 2 }).notNull().default("0"),
    adjustmentEntryId: uuid("adjustment_entry_id").references(() => journalEntries.id),
    closing: numeric("closing", { precision: 18, scale: 2 }).notNull(),
    /** "counted": a count backs the closing. "confirmed": the closing was confirmed by the person, not counted. */
    kind: text("kind").notNull().default("confirmed"),
    countId: uuid("count_id").references(() => daybookCashCounts.id, { onDelete: "set null" }),
    /** The counted total, kept as it was when this was signed off. */
    countedTotal: numeric("counted_total", { precision: 18, scale: 2 }),
    note: text("note"),
    /** "reconciled", or "reopened" once an administrator has undone it. */
    status: text("status").notNull().default("reconciled"),
    reconciledBy: uuid("reconciled_by").references(() => users.id),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedBy: uuid("reopened_by").references(() => users.id),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
    /** The journal lines that were ticked when it was reopened, so the next reconciliation can offer to tick them again. */
    rememberedIds: jsonb("remembered_ids").$type<string[]>(),
  },
  (t) => [index("cash_recon_tenant_account").on(t.tenantId, t.accountId, t.asOfDate)]
);

// The ledger lines that were ticked. A line can be in only one reconciliation at a time; reopening frees them.
export const cashReconciliationLines = pgTable(
  "cash_reconciliation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reconId: uuid("recon_id").notNull().references(() => cashReconciliations.id, { onDelete: "cascade" }),
    journalLineId: uuid("journal_line_id").notNull().references(() => journalLines.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("cash_recon_lines_line").on(t.tenantId, t.journalLineId), index("cash_recon_lines_recon").on(t.reconId)]
);

// A short (or excess) that was posted at a reconciliation, later explained: an expense settled from the Cash short and excess account, or for an excess
// an unrecorded receipt moved to an income account. Nothing here touches the cash itself.
export const cashDifferenceExplanations = pgTable(
  "cash_difference_explanations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reconId: uuid("recon_id").notNull().references(() => cashReconciliations.id, { onDelete: "cascade" }),
    /** "expense" (a shortage found to be an expense) or "income" (an excess found to be an unrecorded receipt). */
    kind: text("kind").notNull(),
    expenseId: uuid("expense_id").references(() => expenses.id),
    entryId: uuid("entry_id").references(() => journalEntries.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    explainedOn: date("explained_on").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cash_explanations_recon").on(t.tenantId, t.reconId)]
);
