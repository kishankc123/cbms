import { pgTable, uuid, text, timestamp, date, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";
import { vendors } from "./purchases";

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  expenseDate: date("expense_date").notNull(),
  categoryAccountId: uuid("category_account_id").notNull().references(() => accounts.id),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  paymentMethod: text("payment_method"),
  attachmentUrl: text("attachment_url"),
  notes: text("notes"),
  bankAccountId: uuid("bank_account_id"),
});
