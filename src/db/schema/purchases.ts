import { pgTable, uuid, text, timestamp, date, numeric, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
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
export const purchaseTypeEnum = pgEnum("purchase_type", ["cash", "credit"]);

export const billTypeEnum = pgEnum("bill_type", ["vat", "pan", "estimate", "challan", "no_bill"]);

// Line items on a Stockable purchase invoice — itemId links to the Inventory
// item master when picked from the dropdown; left null for a free-typed line.
export type PurchaseLineItem = {
  itemId: string | null;
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
});

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
});
