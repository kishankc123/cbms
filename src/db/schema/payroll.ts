import { pgTable, uuid, text, date, numeric, integer, boolean, timestamp, jsonb, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
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
  // Last day of employment, when they have left. Pay stops after it (a run prorates the month they leave in).
  leavingDate: date("leaving_date"),
  department: text("department"),
  designation: text("designation"),
  employmentType: employmentTypeEnum("employment_type").notNull().default("full_time"),
  employmentStatus: employmentStatusEnum("employment_status").notNull().default("active"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  // Which salary-tax slabs apply: "single" or "couple". null = not chosen yet (payroll uses Single and flags it).
  taxStatus: text("tax_status"),
  // For someone who joined after the fiscal year began: what the earlier employer paid and withheld in the same fiscal year.
  priorIncome: numeric("prior_income", { precision: 18, scale: 2 }).notNull().default("0"),
  priorTds: numeric("prior_tds", { precision: 18, scale: 2 }).notNull().default("0"),
  // "resident" or "non_resident" for income tax.
  taxResidency: text("tax_residency").notNull().default("resident"),
  // Confirmed by the organization as qualifying for the first-band (social security tax) exemption. Kept apart from the retirement
  // scheme on purpose: being in SSF does not by itself establish the right to the exemption.
  sstEligible: boolean("sst_eligible").notNull().default(false),
  // The Chart of Accounts liability sub-account this employee posts salary
  // accruals to — a sub-group under the tenant's Salary Payable group,
  // created alongside the employee (see payroll-accounts.ts).
  payableAccountId: uuid("payable_account_id").references(() => accounts.id),
  // The employee's own sub-account under Staff Advances (money paid to them ahead of salary).
  advanceAccountId: uuid("advance_account_id").references(() => accounts.id),
}, (t) => [uniqueIndex("employees_tenant_code").on(t.tenantId, t.employeeCode)]);

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
  /** "fixed" = amount is a sum of money; "percent" = amount is a percentage of the basic salary paid in the period. */
  calcType: text("calc_type").notNull().default("fixed"),
  /** Counts toward the salary SSF / PF contributions are worked on (see the retirement rules). */
  countsForRetirement: boolean("counts_for_retirement").notNull().default(false),
  /** "recurring" = every month while assigned; "one_time" = only the run whose period holds its date (bonus, festival allowance, overtime). */
  recurrence: text("recurrence").notNull().default("recurring"),
  /** Given to every employee when added (and to existing ones when the component is created). Off means each employee is assigned by hand. */
  autoAssign: boolean("auto_assign").notNull().default(false),
});

// Which components an employee gets, from when to when. A change closes the old row and opens a new one so history stays.
// amount null = use the catalog's amount; a value is this person's own amount (or percentage, or the one-time sum).
export const employeeComponents = pgTable("employee_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  componentId: uuid("component_id").notNull().references(() => payrollComponents.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
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
  // month/year are in the calendar the run was created under ("BS": 6 / 2083 = Ashwin 2083);
  // periodStart/periodEnd are the real AD dates and are what every calculation uses.
  calendarSystem: text("calendar_system").notNull().default("AD"),
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
  // Staff advances recovered from this pay; net pay = gross - deductions - advance recovered.
  advanceRecovered: numeric("advance_recovered", { precision: 18, scale: 2 }).notNull().default("0"),
  // Salary TDS withheld this month, the pay it was worked out on (null on runs made before salary TDS existed: gross pay then),
  // and the full working (slab version, projection, slab by slab) so a payslip can always be explained.
  taxablePay: numeric("taxable_pay", { precision: 18, scale: 2 }),
  tdsAmount: numeric("tds_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  tdsDetail: jsonb("tds_detail"),
  // Each component that made up this month's allowances and deductions (name, kind, amount, taxable, counts for retirement), so a payslip can list them.
  componentsDetail: jsonb("components_detail"),
  // Retirement contributions for the month: taken from the employee's pay, and added on top by the employer (never taken from net pay),
  // with the line-by-line breakdown (scheme, contribution, employee, employer). Zero and null for anyone not in a scheme.
  employeeRetirement: numeric("employee_retirement", { precision: 18, scale: 2 }).notNull().default("0"),
  employerRetirement: numeric("employer_retirement", { precision: 18, scale: 2 }).notNull().default("0"),
  retirementDetail: jsonb("retirement_detail"),
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

// The retirement schemes an employee is in, from when to when. SSF and PF never overlap each other; CIT can sit beside either.
// Rates come from the platform's payroll rules for the pay date, not from here.
export const employeeRetirement = pgTable("employee_retirement", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  /** "ssf" | "pf" | "cit" */
  scheme: text("scheme").notNull(),
  registrationNumber: text("registration_number"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  /** CIT only: what the employee chose to put in each month, as a fixed sum or a percentage of basic salary. */
  citMode: text("cit_mode"),
  citValue: numeric("cit_value", { precision: 18, scale: 2 }),
  /** CIT only: what the employer adds each month, where the rules allow it. */
  citEmployerValue: numeric("cit_employer_value", { precision: 18, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
});
