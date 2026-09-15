import { pgTable, uuid, text, timestamp, date, numeric, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import type { LineItem } from "./sales";

export const billStatusEnum = pgEnum("bill_status", [
  "draft",
  "open",
  "paid",
  "partially_paid",
  "overdue",
  "void",
]);

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactInfo: jsonb("contact_info"),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).notNull().default("0"),
});

export const purchaseBills = pgTable("purchase_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  billNumber: text("bill_number").notNull(),
  billDate: date("bill_date").notNull(),
  dueDate: date("due_date"),
  lineItems: jsonb("line_items").$type<LineItem[]>().notNull().default([]),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  status: billStatusEnum("status").notNull().default("draft"),
  amountPaid: numeric("amount_paid", { precision: 18, scale: 2 }).notNull().default("0"),
});
