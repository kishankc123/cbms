import { pgTable, uuid, text, timestamp, date, numeric, integer, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";
import { vendors } from "./purchases";
import { expenses } from "./expenses";

export const recurringExpenseFrequencyEnum = pgEnum("recurring_expense_frequency", ["monthly", "quarterly", "half_yearly", "yearly", "custom"]);
export const recurringExpenseRecognitionRuleEnum = pgEnum("recurring_expense_recognition_rule", ["first_day", "last_day", "specific_day"]);
export const recurringExpenseDueRuleEnum = pgEnum("recurring_expense_due_rule", ["same_day", "specific_day_same_month", "specific_day_following_month", "days_after_recognition"]);
export const recurringExpensePriorityEnum = pgEnum("recurring_expense_priority", ["critical", "high", "normal", "low"]);
export const recurringExpenseStatusEnum = pgEnum("recurring_expense_status", ["active", "paused", "stopped"]);

/**
 * The DEFINITION of a repeating expense (rent, internet, insurance, ...) — this
 * row never posts to the ledger itself. Expanding it into scheduled occurrences,
 * and posting the real `expenses` row once an occurrence's recognition date
 * arrives, is `recurringExpenseInstances` plus the generation engine's job
 * (src/lib/recurring-expenses.ts). Editing this row only ever affects
 * occurrences not yet generated — see `effectiveFrom` below, and the instance
 * table's own `expectedAmount` snapshot which protects already-generated
 * history from a later rate change.
 */
export const recurringExpenses = pgTable("recurring_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  expenseName: text("expense_name").notNull(),
  // Same Fixed/Variable expense account rule as one-off expenses — never Cost
  // of Goods Sold (Purchases) or Salaries (Payroll).
  expenseAccountId: uuid("expense_account_id").notNull().references(() => accounts.id),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  payeeName: text("payee_name"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),

  frequency: recurringExpenseFrequencyEnum("frequency").notNull(),
  // Months between occurrences: 1/3/6/12 for monthly/quarterly/half_yearly/yearly,
  // user-chosen for "custom". A plain month interval (rather than a richer
  // recurrence-rule grammar) covers every frequency the spec asks for with one
  // code path in the generation engine.
  intervalMonths: integer("interval_months").notNull().default(1),

  recognitionRule: recurringExpenseRecognitionRuleEnum("recognition_rule").notNull().default("last_day"),
  // Day-of-month for "specific_day" — clamped to the month's real length in
  // the organization's calendar (the 30th of a 29-day month lands on the 29th).
  recognitionDay: integer("recognition_day"),

  dueRule: recurringExpenseDueRuleEnum("due_rule").notNull().default("specific_day_following_month"),
  // Day-of-month for the "specific_day_*" rules, or a day COUNT for "days_after_recognition".
  dueRuleValue: integer("due_rule_value"),

  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  // Occurrences are only ever generated on/after this date — the recurrence's
  // own low-water mark. Starts equal to startDate; a Resume bumps it forward
  // so the paused window is never generated, without needing a separate
  // pause-history table.
  effectiveFrom: date("effective_from").notNull(),

  priority: recurringExpensePriorityEnum("priority").notNull().default("normal"),
  // The cash/bank account expected to fund payment — for planning only, never posted to directly.
  expectedPaymentAccountId: uuid("expected_payment_account_id").references(() => accounts.id),
  notes: text("notes"),

  status: recurringExpenseStatusEnum("status").notNull().default("active"),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  // Occurrences on/after this date are never generated once stopped (null while active/paused).
  stoppedEffectiveDate: date("stopped_effective_date"),

  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One scheduled occurrence of a recurring expense. Created ahead of its
 * recognition date as a forecast (`expenseId` null — the spec's "Expected
 * Future Payment"), then linked to the real posted `expenses` row once the
 * generation engine runs on/after `expenseDate` (the spec's "Actual Payable").
 * From there, status, partial payments, and everything else is the *existing*
 * expenses/payments machinery — this table only ever tracks the schedule,
 * never a second copy of payable state.
 */
export const recurringExpenseInstances = pgTable(
  "recurring_expense_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    recurringExpenseId: uuid("recurring_expense_id").notNull().references(() => recurringExpenses.id, { onDelete: "cascade" }),
    // "BS:2083-06" / "AD:2026-09" — the occurrence's period, in whichever
    // calendar the recurring expense was scheduled in. With recurringExpenseId
    // this is what makes generation idempotent (see the unique index below),
    // the same pattern compliance obligations use for their own periodKey.
    periodKey: text("period_key").notNull(),
    periodLabel: text("period_label").notNull(),
    // Computed once at generation time from the rules above — a later edit to
    // the recurring expense's rules never moves an occurrence already scheduled.
    expenseDate: date("expense_date").notNull(),
    dueDate: date("due_date"),
    expectedAmount: numeric("expected_amount", { precision: 18, scale: 2 }).notNull(),
    // Null = forecast only, not yet in the ledger. Set once the recognition
    // engine posts the real expense on/after expenseDate.
    expenseId: uuid("expense_id").references(() => expenses.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recurring_expense_instances_period").on(t.recurringExpenseId, t.periodKey)]
);
