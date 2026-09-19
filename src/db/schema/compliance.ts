import { pgTable, uuid, text, timestamp, date, numeric, boolean, pgEnum } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";

// ---------- Period locking ----------

export const periodStatusEnum = pgEnum("period_status", ["open", "pending_close", "closed", "reopened"]);

export const accountingPeriods = pgTable("accounting_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  label: text("label").notNull(),
  status: periodStatusEnum("status").notNull().default("open"),
  closedBy: uuid("closed_by").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => users.id),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenReason: text("reopen_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Rules & Policies ----------

// A fixed, structured set of supported checks — thresholds are configurable
// per rule, but the checks themselves are tested evaluators, not a
// free-text expression language.
export const ruleCheckTypeEnum = pgEnum("rule_check_type", [
  "amount_threshold",
  "missing_pan",
  "duplicate_invoice",
  "closed_period_posting",
  "bank_unreconciled_days",
  "negative_balance",
  "backdated_transaction",
]);

export const ruleSeverityEnum = pgEnum("rule_severity", ["information", "warning", "review_required", "blocking"]);
export const ruleActionEnum = pgEnum("rule_action", ["warn", "block", "create_exception"]);
export const ruleModuleEnum = pgEnum("rule_module", ["sales", "purchases", "expenses", "payroll", "bank_reconciliation", "general"]);

export const complianceRules = pgTable("compliance_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  applicableModule: ruleModuleEnum("applicable_module").notNull().default("general"),
  checkType: ruleCheckTypeEnum("check_type").notNull(),
  thresholdValue: numeric("threshold_value", { precision: 18, scale: 2 }),
  severity: ruleSeverityEnum("severity").notNull().default("warning"),
  action: ruleActionEnum("action").notNull().default("warn"),
  // Field only — no approval workflow is enforced (out of scope for now);
  // this just records whether the policy calls for one.
  approvalRequired: boolean("approval_required").notNull().default(false),
  effectiveDate: date("effective_date"),
  expiryDate: date("expiry_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Exception Centre ----------

export const exceptionTypeEnum = pgEnum("exception_type", [
  "duplicate_invoice",
  "duplicate_payment",
  "missing_pan",
  "missing_tax_info",
  "missing_supporting_document",
  "unreconciled_bank_transaction",
  "negative_cash_balance",
  "unapproved_transaction",
  "backdated_transaction",
  "closed_period_transaction",
  "incorrect_tax_treatment",
  "unusual_transaction_value",
  "other",
]);

export const exceptionSeverityEnum = pgEnum("exception_severity", ["information", "warning", "review_required", "blocking"]);
export const exceptionStatusEnum = pgEnum("exception_status", ["open", "assigned", "under_review", "resolved", "closed"]);

export const complianceExceptions = pgTable("compliance_exceptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  transactionType: text("transaction_type"),
  transactionId: text("transaction_id"),
  exceptionType: exceptionTypeEnum("exception_type").notNull(),
  severity: exceptionSeverityEnum("severity").notNull().default("warning"),
  description: text("description").notNull(),
  detectedDate: timestamp("detected_date", { withTimezone: true }).notNull().defaultNow(),
  assignedUserId: uuid("assigned_user_id").references(() => users.id),
  status: exceptionStatusEnum("status").notNull().default("open"),
  resolution: text("resolution"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // A stable key (e.g. "duplicate_invoice:vendorId:invoiceNumber") so a
  // re-run scan doesn't create duplicate exception rows for the same issue.
  dedupeKey: text("dedupe_key").notNull(),
});

// ---------- Compliance Calendar ----------

export const complianceItemStatusEnum = pgEnum("compliance_item_status", [
  "upcoming",
  "due",
  "prepared",
  "under_review",
  "submitted",
  "paid",
  "completed",
  "overdue",
]);

export const complianceCalendarItems = pgTable("compliance_calendar_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  applicableCompany: text("applicable_company"),
  period: text("period").notNull(),
  dueDate: date("due_date").notNull(),
  responsibleUserId: uuid("responsible_user_id").references(() => users.id),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  status: complianceItemStatusEnum("status").notNull().default("upcoming"),
  submissionDate: date("submission_date"),
  paymentDate: date("payment_date"),
  supportingDocument: text("supporting_document"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
