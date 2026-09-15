import { pgTable, uuid, text, timestamp, date, numeric, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { bankAccounts } from "./banking";

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  paymentDate: date("payment_date").notNull(),
  paidToVendorId: uuid("paid_to_vendor_id"),
  paidToOther: text("paid_to_other"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  appliedToBillIds: jsonb("applied_to_bill_ids").$type<string[]>().notNull().default([]),
});

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  receiptDate: date("receipt_date").notNull(),
  receivedFromCustomerId: uuid("received_from_customer_id"),
  receivedFromOther: text("received_from_other"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  appliedToInvoiceIds: jsonb("applied_to_invoice_ids").$type<string[]>().notNull().default([]),
});
