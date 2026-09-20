import { pgTable, uuid, text, timestamp, date, numeric, pgEnum, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";
import { vendors, billTypeEnum } from "./purchases";

export const expenseStatusEnum = pgEnum("expense_status", ["unpaid", "partially_paid", "paid", "void"]);

// How VAT applies to this expense — drives whether the VAT field is
// computed from the tenant's configured rate at all.
export const expenseTaxTreatmentEnum = pgEnum("expense_tax_treatment", ["taxable", "exempt", "zero_rated"]);

// Operating/other business expenses — distinct from the Purchases module
// (goods/inventory bought for resale) and the Payroll module (salaries),
// which must never be recorded here.
export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  expenseNumber: text("expense_number").notNull(),
  expenseDate: date("expense_date").notNull(),
  // Must be a Fixed/Variable expense account from the Chart of Accounts —
  // never Cost of Goods Sold (Purchases) or Salaries (Payroll).
  categoryAccountId: uuid("category_account_id").notNull().references(() => accounts.id),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  payeeName: text("payee_name"),
  description: text("description"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  // Optional — when set, an unpaid/partially-paid expense past this date
  // counts toward the "Overdue" summary card.
  dueDate: date("due_date"),
  // The kind of supporting bill (as on purchases). VAT can only be recorded on a VAT bill.
  billType: billTypeEnum("bill_type").notNull().default("no_bill"),
  // Whether the paper bill is physically in hand (an audit-readiness input). Null on expenses entered before it was asked.
  billAvailable: boolean("bill_available"),
  taxTreatment: expenseTaxTreatmentEnum("tax_treatment").notNull().default("taxable"),
  taxableAmount: numeric("taxable_amount", { precision: 18, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  tdsAmount: numeric("tds_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  otherTaxAmount: numeric("other_tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  // subtotal = taxableAmount; total = subtotal + vatAmount + otherTaxAmount;
  // amountPayable = total - tdsAmount (TDS is withheld from the payee, not
  // an added cost — see expense-accounts.ts for the posting logic).
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  amountPayable: numeric("amount_payable", { precision: 18, scale: 2 }).notNull(),
  amountPaid: numeric("amount_paid", { precision: 18, scale: 2 }).notNull().default("0"),
  status: expenseStatusEnum("status").notNull().default("unpaid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("expenses_tenant_number").on(t.tenantId, t.expenseNumber)]);
