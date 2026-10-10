import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses } from "@/db/schema";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { assertSupplierOwned, assertCashBankAccounts } from "@/lib/ledger/account-guards";
import { resolvePaymentMode } from "@/lib/payment-modes";
import { intervalMonthsFor, type RecurringFrequency, type RecognitionRule, type DueRule, type RecurringPriority } from "./schedule";

export * from "./schedule";
export * from "./summary";
export * from "./history";

// ------------------------------------------------------------------
// CRUD — the recurring expense DEFINITION only. Nothing here ever touches the
// ledger or the `expenses` table: that's the generation engine's job (Phase 2).
// ------------------------------------------------------------------

export type RecurringExpenseInput = {
  expenseName: string;
  expenseAccountId: string;
  vendorId: string | null;
  payeeName: string | null;
  amount: number;
  frequency: RecurringFrequency;
  customIntervalMonths: number | null;
  recognitionRule: RecognitionRule;
  recognitionDay: number | null;
  dueRule: DueRule;
  dueRuleValue: number | null;
  startDate: string;
  endDate: string | null;
  priority: RecurringPriority;
  expectedPaymentAccountId: string | null;
  /** The mode expected with that account (Cash, Cheque, ...). Planning only. */
  expectedPaymentModeId?: string | null;
  notes: string | null;
};

async function validateRecurringExpenseInput(tenantId: string, input: RecurringExpenseInput) {
  if (!input.expenseName.trim()) throw new Error("Expense name is required");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
  if (!input.startDate) throw new Error("Start date is required");
  if (input.endDate && input.endDate < input.startDate) throw new Error("End date can't be before the start date");
  if (input.frequency === "custom" && !(input.customIntervalMonths && input.customIntervalMonths > 0)) {
    throw new Error("Enter how many months a custom-frequency expense repeats every");
  }
  if (input.recognitionRule === "specific_day" && !(input.recognitionDay && input.recognitionDay >= 1 && input.recognitionDay <= 31)) {
    throw new Error("Enter a day of the month (1–31) for a specific recognition day");
  }
  if ((input.dueRule === "specific_day_same_month" || input.dueRule === "specific_day_following_month") && !(input.dueRuleValue && input.dueRuleValue >= 1 && input.dueRuleValue <= 31)) {
    throw new Error("Enter a day of the month (1–31) for the payment due date");
  }
  if (input.dueRule === "days_after_recognition" && !(input.dueRuleValue !== null && input.dueRuleValue >= 0)) {
    throw new Error("Enter how many days after recognition payment is due");
  }

  const categoryAccounts = await getExpenseCategoryAccounts(tenantId);
  if (!categoryAccounts.some((a) => a.id === input.expenseAccountId)) {
    throw new Error("Select a valid expense account — it must be an active Direct/Indirect expense account, and a category that has sub-categories can't be used itself");
  }
  if (input.vendorId) await assertSupplierOwned(tenantId, input.vendorId);
  if (input.expectedPaymentAccountId) await assertCashBankAccounts(tenantId, [input.expectedPaymentAccountId]);
}

// The mode chosen with the expected account has to be a real mode of this organization that includes that account; its name is stored.
async function expectedMode(tenantId: string, input: RecurringExpenseInput) {
  if (!input.expectedPaymentModeId || !input.expectedPaymentAccountId) return { paymentModeId: null, paymentModeName: null };
  const r = await resolvePaymentMode(tenantId, input.expectedPaymentModeId, input.expectedPaymentAccountId);
  return { paymentModeId: r.paymentModeId, paymentModeName: r.paymentModeName };
}

export async function listRecurringExpenses(tenantId: string) {
  return db.select().from(recurringExpenses).where(eq(recurringExpenses.tenantId, tenantId)).orderBy(desc(recurringExpenses.createdAt));
}

export async function getRecurringExpenseById(tenantId: string, id: string) {
  const [row] = await db.select().from(recurringExpenses).where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.id, id))).limit(1);
  return row ?? null;
}

export async function createRecurringExpense(tenantId: string, userId: string, input: RecurringExpenseInput) {
  await validateRecurringExpenseInput(tenantId, input);
  const mode = await expectedMode(tenantId, input);
  const [row] = await db
    .insert(recurringExpenses)
    .values({
      tenantId,
      expenseName: input.expenseName.trim(),
      expenseAccountId: input.expenseAccountId,
      vendorId: input.vendorId,
      payeeName: input.payeeName?.trim() || null,
      amount: input.amount.toFixed(2),
      frequency: input.frequency,
      intervalMonths: intervalMonthsFor(input.frequency, input.customIntervalMonths ?? 1),
      recognitionRule: input.recognitionRule,
      recognitionDay: input.recognitionRule === "specific_day" ? input.recognitionDay : null,
      dueRule: input.dueRule,
      dueRuleValue: input.dueRule === "same_day" ? null : input.dueRuleValue,
      startDate: input.startDate,
      endDate: input.endDate,
      effectiveFrom: input.startDate,
      priority: input.priority,
      expectedPaymentAccountId: input.expectedPaymentAccountId,
      expectedPaymentModeId: mode.paymentModeId,
      expectedPaymentModeName: mode.paymentModeName,
      notes: input.notes?.trim() || null,
      createdBy: userId,
    })
    .returning();
  return row;
}

export async function updateRecurringExpense(tenantId: string, userId: string, id: string, input: RecurringExpenseInput) {
  const existing = await getRecurringExpenseById(tenantId, id);
  if (!existing) throw new Error("Recurring expense not found");
  await validateRecurringExpenseInput(tenantId, input);
  const mode = await expectedMode(tenantId, input);

  const [row] = await db
    .update(recurringExpenses)
    .set({
      expenseName: input.expenseName.trim(),
      expenseAccountId: input.expenseAccountId,
      vendorId: input.vendorId,
      payeeName: input.payeeName?.trim() || null,
      amount: input.amount.toFixed(2),
      frequency: input.frequency,
      intervalMonths: intervalMonthsFor(input.frequency, input.customIntervalMonths ?? 1),
      recognitionRule: input.recognitionRule,
      recognitionDay: input.recognitionRule === "specific_day" ? input.recognitionDay : null,
      dueRule: input.dueRule,
      dueRuleValue: input.dueRule === "same_day" ? null : input.dueRuleValue,
      startDate: input.startDate,
      endDate: input.endDate,
      priority: input.priority,
      expectedPaymentAccountId: input.expectedPaymentAccountId,
      expectedPaymentModeId: mode.paymentModeId,
      expectedPaymentModeName: mode.paymentModeName,
      notes: input.notes?.trim() || null,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.id, id)))
    .returning();
  return row;
}

export async function pauseRecurringExpense(tenantId: string, id: string) {
  const existing = await getRecurringExpenseById(tenantId, id);
  if (!existing) throw new Error("Recurring expense not found");
  if (existing.status !== "active") throw new Error("Only an active recurring expense can be paused");
  const [row] = await db
    .update(recurringExpenses)
    .set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.id, id)))
    .returning();
  return row;
}

/** `resumeFrom` is the date recurrence picks back up — the paused window is never generated,
 * without needing a separate pause-history table (see `effectiveFrom`'s own comment in the schema). */
export async function resumeRecurringExpense(tenantId: string, id: string, resumeFrom: string) {
  const existing = await getRecurringExpenseById(tenantId, id);
  if (!existing) throw new Error("Recurring expense not found");
  if (existing.status !== "paused") throw new Error("Only a paused recurring expense can be resumed");
  if (!resumeFrom) throw new Error("Resume date is required");
  const [row] = await db
    .update(recurringExpenses)
    .set({ status: "active", pausedAt: null, effectiveFrom: resumeFrom, updatedAt: new Date() })
    .where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.id, id)))
    .returning();
  return row;
}

/** Stopping never touches history — existing instances and their posted expenses/liabilities
 * are untouched; only occurrences on/after `effectiveDate` are never generated. */
export async function stopRecurringExpense(tenantId: string, id: string, effectiveDate: string) {
  const existing = await getRecurringExpenseById(tenantId, id);
  if (!existing) throw new Error("Recurring expense not found");
  if (existing.status === "stopped") throw new Error("This recurring expense is already stopped");
  if (!effectiveDate) throw new Error("Effective date is required");
  const [row] = await db
    .update(recurringExpenses)
    .set({ status: "stopped", stoppedAt: new Date(), stoppedEffectiveDate: effectiveDate, updatedAt: new Date() })
    .where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.id, id)))
    .returning();
  return row;
}
