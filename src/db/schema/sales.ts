import { pgTable, uuid, text, timestamp, date, numeric, integer, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "partially_paid",
  "overdue",
  "void",
]);

// Whether VAT applies to this invoice at all — mirrors expenses.taxTreatment
// (src/db/schema/expenses.ts) but 2-way, since a sales invoice's "Bill Type" is
// the user-facing name for this: Taxable calculates VAT at the tenant's
// registered rate, Zero-rated always posts zero VAT regardless of that rate.
export const invoiceTaxTreatmentEnum = pgEnum("invoice_tax_treatment", ["taxable", "zero_rated"]);

export type ContactInfo = {
  email?: string;
  phone?: string;
  details?: string;
};

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  panNumber: text("pan_number"),
  contactInfo: jsonb("contact_info").$type<ContactInfo>(),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  // This customer's own sub-account under Accounts Receivable — every sale,
  // receipt, and opening balance posts here instead of the shared AR
  // control account (see subledger-accounts.ts).
  receivableAccountId: uuid("receivable_account_id").references(() => accounts.id),
  // This customer's own sub-account under Customer Advance: money they paid before (or beyond) an invoice sits here
  // until it is applied to an invoice or paid back. Linked by id, never by name.
  advanceAccountId: uuid("advance_account_id").references(() => accounts.id),
});

export type LineItem = {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
};

/** One file imported through Sales > Import Sales: what it brought in, so the whole import can be reviewed or undone together. */
export const salesImports = pgTable(
  "sales_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    invoiceCount: integer("invoice_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Customers this import created (ticked in the review), so they can be seen with it. */
    customersCreated: jsonb("customers_created").$type<{ id: string; name: string }[]>().notNull().default([]),
    /** completed | stopped (a row failed part-way) | undone | partly_undone */
    status: text("status").notNull().default("completed"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sales_imports_tenant").on(t.tenantId, t.createdAt)]
);

/** A name as it appears in someone's files, remembered against the customer it was matched to, so it matches by itself next time. */
export const customerAliases = pgTable(
  "customer_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** Lower-cased, punctuation and spacing normalized. */
    alias: text("alias").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_aliases_tenant_alias").on(t.tenantId, t.alias)]
);

/** The column mapping last used for a file with these headers, so the same layout needs no mapping next time. */
export const importColumnMappings = pgTable(
  "import_column_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    signature: text("signature").notNull(),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("import_column_mappings_key").on(t.tenantId, t.kind, t.signature)]
);

export const salesInvoices = pgTable("sales_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"),
  lineItems: jsonb("line_items").$type<LineItem[]>().notNull().default([]),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  // Taxable amount (gross - discount); kept as "subtotal" since it's the same
  // pre-tax figure the ledger posting and reports already key off of.
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
  // "Bill Type" in the UI. Taxable -> VAT computed at the tenant's registered rate;
  // Zero-rated -> taxAmount is always 0 regardless of that rate.
  taxTreatment: invoiceTaxTreatmentEnum("tax_treatment").notNull().default("taxable"),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  amountPaid: numeric("amount_paid", { precision: 18, scale: 2 }).notNull().default("0"),
  /** Set when the invoice came in through Import Sales. */
  importId: uuid("import_id").references(() => salesImports.id),
});

// A sales return (issued to the customer as a debit note): goods sent back or a price
// correction. Mirrors an invoice in shape, but reduces what the customer owes.
export const salesReturns = pgTable("sales_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  noteNumber: text("note_number").notNull(),
  noteDate: date("note_date").notNull(),
  lineItems: jsonb("line_items").$type<LineItem[]>().notNull().default([]),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  status: text("status").$type<"issued" | "void">().notNull().default("issued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_returns_tenant_number").on(t.tenantId, t.noteNumber)]);
