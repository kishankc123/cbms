import { pgTable, uuid, text, timestamp, date, numeric, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "partially_paid",
  "overdue",
  "void",
]);

export type ContactInfo = {
  email?: string;
  phone?: string;
  details?: string;
};

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactInfo: jsonb("contact_info").$type<ContactInfo>(),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  // This customer's own sub-account under Accounts Receivable — every sale,
  // receipt, and opening balance posts here instead of the shared AR
  // control account (see subledger-accounts.ts).
  receivableAccountId: uuid("receivable_account_id").references(() => accounts.id),
});

export type LineItem = {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
};

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
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  amountPaid: numeric("amount_paid", { precision: 18, scale: 2 }).notNull().default("0"),
});
