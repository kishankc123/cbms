import { pgTable, uuid, text, date, numeric, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { vendors } from "./purchases";

// Reconciling a supplier's own statement against our supplier account. The statement rows are kept (not the file), so a reconciliation can be
// reopened; our side is read live from the ledger each time. Nothing here posts to the books: leftovers are fixed through the usual screens.

export const supplierReconStatusEnum = pgEnum("supplier_recon_status", ["draft", "reconciled"]);

export const supplierReconciliations = pgTable(
  "supplier_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    fileName: text("file_name").notNull().default(""),
    /** "credit_is_bill": a credit on their statement is a bill to us (the usual way). "debit_is_bill": their statement is written the other way round. */
    orientation: text("orientation").notNull().default("credit_is_bill"),
    /** What the supplier's statement says we owed at the start of the period and at its end (positive = we owe them). */
    theirOpening: numeric("their_opening", { precision: 18, scale: 2 }).notNull().default("0"),
    theirClosing: numeric("their_closing", { precision: 18, scale: 2 }).notNull().default("0"),
    /** What our books said we owed at the end of the period, kept when it was signed off so the history stays as it was signed even if the books change later. */
    ourClosing: numeric("our_closing", { precision: 18, scale: 2 }),
    dateToleranceDays: integer("date_tolerance_days").notNull().default(7),
    amountTolerance: numeric("amount_tolerance", { precision: 18, scale: 2 }).notNull().default("1"),
    status: supplierReconStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    signedOffBy: uuid("signed_off_by").references(() => users.id),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
  },
  (t) => [index("supplier_recon_tenant_vendor").on(t.tenantId, t.vendorId)]
);

// One row of the supplier's statement, with its effect on what we owe them (positive = a bill, negative = a payment or credit).
export const supplierReconLines = pgTable("supplier_recon_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  reconId: uuid("recon_id").notNull().references(() => supplierReconciliations.id, { onDelete: "cascade" }),
  rowNo: integer("row_no").notNull(),
  txDate: date("tx_date").notNull(),
  reference: text("reference").notNull().default(""),
  description: text("description").notNull().default(""),
  effect: numeric("effect", { precision: 18, scale: 2 }).notNull(),
});

// A match joins lines on their statement with entries in our books: one to one, or several to one. "suggested" waits for the person's OK.
export const supplierReconMatches = pgTable("supplier_recon_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  reconId: uuid("recon_id").notNull().references(() => supplierReconciliations.id, { onDelete: "cascade" }),
  /** reference, reference_diff, amount_date, combination or manual. */
  kind: text("kind").notNull(),
  /** "confirmed" counts as matched; "suggested" is waiting for the person to confirm or undo it. */
  status: text("status").notNull().default("suggested"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The lines of a match: a statement line (theirLineId) or an entry in our books (entryId, the journal entry).
export const supplierReconMatchItems = pgTable(
  "supplier_recon_match_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull().references(() => supplierReconMatches.id, { onDelete: "cascade" }),
    reconId: uuid("recon_id").notNull().references(() => supplierReconciliations.id, { onDelete: "cascade" }),
    theirLineId: uuid("their_line_id").references(() => supplierReconLines.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id"),
  },
  (t) => [index("supplier_recon_items_recon").on(t.reconId)]
);

// Why a leftover is there: timing (the other side will catch up), a dispute, or a note. Keyed by the statement line or the book entry.
export const supplierReconFlags = pgTable("supplier_recon_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  reconId: uuid("recon_id").notNull().references(() => supplierReconciliations.id, { onDelete: "cascade" }),
  theirLineId: uuid("their_line_id").references(() => supplierReconLines.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id"),
  /** timing, dispute, our_error, their_error or other. */
  reason: text("reason").notNull(),
  note: text("note"),
});
