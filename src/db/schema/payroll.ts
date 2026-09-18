import { pgTable, uuid, text, date, numeric, integer, boolean, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";

export const employmentTypeEnum = pgEnum("employment_type", ["full_time", "part_time", "contract", "intern"]);
export const employmentStatusEnum = pgEnum("employment_status", ["active", "inactive", "terminated", "on_leave"]);

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeCode: text("employee_code").notNull(),
  fullName: text("full_name").notNull(),
  address: text("address"),
  contactNumber: text("contact_number"),
  email: text("email"),
  panNumber: text("pan_number"),
  joiningDate: date("joining_date").notNull(),
  department: text("department"),
  designation: text("designation"),
  employmentType: employmentTypeEnum("employment_type").notNull().default("full_time"),
  employmentStatus: employmentStatusEnum("employment_status").notNull().default("active"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  // The Chart of Accounts liability sub-account this employee posts salary
  // accruals to — a sub-group under the tenant's Salary Payable group,
  // created alongside the employee (see payroll-accounts.ts).
  payableAccountId: uuid("payable_account_id").references(() => accounts.id),
});

// "current basic salary" is deliberately NOT stored here — the employee's
// salary at any point in time (including "now") is always derived from
// salaryHistory, so there is exactly one source of truth. See getSalaryAsOf.
export const salaryChangeTypeEnum = pgEnum("salary_change_type", [
  "initial",
  "percentage_increase",
  "percentage_decrease",
  "fixed_increase",
  "fixed_decrease",
  "new_fixed",
]);

export const salaryHistory = pgTable("salary_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(),
  basicSalary: numeric("basic_salary", { precision: 18, scale: 2 }).notNull(),
  changeType: salaryChangeTypeEnum("change_type").notNull(),
  previousSalary: numeric("previous_salary", { precision: 18, scale: 2 }),
  changeAmount: numeric("change_amount", { precision: 18, scale: 2 }),
  changePercentage: numeric("change_percentage", { precision: 7, scale: 2 }),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
});

export const benefitFrequencyEnum = pgEnum("benefit_frequency", ["monthly", "yearly", "one_time"]);
export const benefitStatusEnum = pgEnum("benefit_status", ["active", "inactive"]);

// Historical like salaryHistory: a benefit amount change closes the prior
// record (sets effectiveTo) and inserts a new one, rather than overwriting.
export const employeeBenefits = pgTable("employee_benefits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
  eligibilityGroup: text("eligibility_group"),
  benefitType: text("benefit_type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  frequency: benefitFrequencyEnum("frequency").notNull().default("monthly"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  eligibilityStatus: benefitStatusEnum("eligibility_status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
});

export const payrollComponentTypeEnum = pgEnum("payroll_component_type", ["allowance", "deduction"]);

// Setup > Payroll Components: the catalog of allowances/deductions available
// when building a salary sheet line (kept intentionally simple — a flat
// amount per component, not a rules engine).
export const payrollComponents = pgTable("payroll_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: payrollComponentTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
  taxable: boolean("taxable").notNull().default(true),
});

export const prorationMethodEnum = pgEnum("proration_method", ["prorate", "new_full_month", "old_full_month"]);
export const workingDaysMethodEnum = pgEnum("working_days_method", ["calendar_days", "exclude_weekly_holidays"]);

// One row per tenant — payroll-specific configuration, kept out of the
// tenant's general Settings so it never affects non-payroll behavior.
export const payrollSettings = pgTable("payroll_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  prorationMethod: prorationMethodEnum("proration_method").notNull().default("prorate"),
  workingDaysMethod: workingDaysMethodEnum("working_days_method").notNull().default("exclude_weekly_holidays"),
  // 0 = Sunday ... 6 = Saturday
  weeklyHolidays: jsonb("weekly_holidays").$type<number[]>().notNull().default([6]),
  publicHolidays: jsonb("public_holidays").$type<string[]>().notNull().default([]),
  payrollStartDay: integer("payroll_start_day").notNull().default(1),
  payrollEndDay: integer("payroll_end_day").notNull().default(31),
  roundingRule: text("rounding_rule").notNull().default("none"),
});

export const payrollRunStatusEnum = pgEnum("payroll_run_status", ["draft", "review", "approved", "finalized"]);

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: payrollRunStatusEnum("status").notNull().default("draft"),
  processingDate: date("processing_date"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
});

// A snapshot per employee for a payroll run — once the run is finalized,
// these rows are never recomputed, even if salaryHistory/benefits change
// later. Recomputation before finalization simply replaces the draft rows.
export const payrollLines = pgTable("payroll_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  payrollRunId: uuid("payroll_run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  basicSalary: numeric("basic_salary", { precision: 18, scale: 2 }).notNull(),
  workingDays: numeric("working_days", { precision: 6, scale: 2 }).notNull(),
  presentDays: numeric("present_days", { precision: 6, scale: 2 }).notNull(),
  absentDays: numeric("absent_days", { precision: 6, scale: 2 }).notNull(),
  proratedBasic: numeric("prorated_basic", { precision: 18, scale: 2 }).notNull(),
  allowances: numeric("allowances", { precision: 18, scale: 2 }).notNull().default("0"),
  deductions: numeric("deductions", { precision: 18, scale: 2 }).notNull().default("0"),
  overtimeAmount: numeric("overtime_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  benefitsAmount: numeric("benefits_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  grossPay: numeric("gross_pay", { precision: 18, scale: 2 }).notNull(),
  netPay: numeric("net_pay", { precision: 18, scale: 2 }).notNull(),
});

export const attendanceStatusEnum = pgEnum("attendance_status", ["present", "absent", "leave", "half_day"]);

export const attendanceRecords = pgTable("attendance_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: attendanceStatusEnum("status").notNull().default("present"),
  notes: text("notes"),
});
