import { pgTable, uuid, text, timestamp, date, numeric, integer, jsonb, pgEnum, uniqueIndex, index, boolean } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";

export const billStatusEnum = pgEnum("bill_status", [
  "draft",
  "open",
  "paid",
  "partially_paid",
  "overdue",
  "void",
]);

// "cash" backs Consumable purchase (settled immediately, no Accounts Payable
// involved); "credit" backs Stockable purchase (goes on account and posts to
// Accounts Payable like a normal bill). Values kept as-is — only the
// user-facing labels changed.
export const purchaseTypeEnum = pgEnum("purchase_type", ["cash", "credit", "asset"]);

export const billTypeEnum = pgEnum("bill_type", ["vat", "pan", "estimate", "challan", "no_bill"]);

// Line items on a Stockable purchase invoice — itemId links to the Inventory
// item master when picked from the dropdown; left null for a free-typed line.
export type PurchaseLineItem = {
  itemId: string | null;
  // Set on Consumable purchase lines: the purchase category (Cost of Goods Sold sub-group) the line is booked to.
  categoryId?: string | null;
  description: string;
  rate: number;
  quantity: number;
  discount: number;
};

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactInfo: jsonb("contact_info"),
  panNumber: text("pan_number"),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  // This supplier's own sub-account under Accounts Payable — every purchase,
  // payment, and opening balance posts here instead of the shared AP
  // control account (see subledger-accounts.ts).
  payableAccountId: uuid("payable_account_id").references(() => accounts.id),
  // This supplier's own sub-account under Supplier Advance (money we paid ahead of a bill). Linked by id, never by name.
  advanceAccountId: uuid("advance_account_id").references(() => accounts.id),
});

/** One file imported through Purchases > Import Purchases: what it brought in, so the whole import can be reviewed or undone together. */
export const purchaseImports = pgTable(
  "purchase_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    billCount: integer("bill_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Suppliers this import created (ticked in the review). */
    suppliersCreated: jsonb("suppliers_created").$type<{ id: string; name: string }[]>().notNull().default([]),
    /** importing | completed | stopped (a row failed part-way) | undone | partly_undone */
    status: text("status").notNull().default("importing"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("purchase_imports_tenant").on(t.tenantId, t.createdAt)]
);

/** A supplier name as it appears in someone's files, remembered against the supplier it was matched to. */
export const supplierAliases = pgTable(
  "supplier_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    vendorId: uuid("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("supplier_aliases_tenant_alias").on(t.tenantId, t.alias)]
);

export const purchaseBills = pgTable("purchase_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  // Nullable: a Consumable purchase with no supplier chosen leaves this
  // blank rather than being attributed to a placeholder vendor.
  vendorId: uuid("vendor_id").references(() => vendors.id),
  billNumber: text("bill_number").notNull(),
  billDate: date("bill_date").notNull(),
  dueDate: date("due_date"),
  description: text("description"),
  lineItems: jsonb("line_items").$type<PurchaseLineItem[]>().notNull().default([]),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  status: billStatusEnum("status").notNull().default("draft"),
  amountPaid: numeric("amount_paid", { precision: 18, scale: 2 }).notNull().default("0"),
  purchaseType: purchaseTypeEnum("purchase_type").notNull().default("credit"),
  billType: billTypeEnum("bill_type").notNull().default("no_bill"),
  // Whether the paper bill is physically in hand (an audit-readiness input). Null on bills entered before it was asked.
  billAvailable: boolean("bill_available"),
  /** Set when the bill came in through Import Purchases. */
  importId: uuid("import_id").references(() => purchaseImports.id),
});

// A purchase return (credit note for the supplier): goods sent back to them. Mirrors a stockable
// purchase invoice in shape, but reduces what we owe the supplier.
export const purchaseReturns = pgTable("purchase_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  noteNumber: text("note_number").notNull(),
  noteDate: date("note_date").notNull(),
  lineItems: jsonb("line_items").$type<PurchaseLineItem[]>().notNull().default([]),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  status: text("status").$type<"issued" | "void">().notNull().default("issued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("purchase_returns_tenant_number").on(t.tenantId, t.noteNumber)]);
