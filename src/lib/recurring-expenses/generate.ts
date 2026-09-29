import { and, eq, isNull, lte, asc } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses, recurringExpenseInstances, expenses } from "@/db/schema";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { getOrCreateExpensePayableAccount } from "@/lib/ledger/expense-accounts";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { logAuditEvent } from "@/lib/audit";
import { addMonths, monthRange, type CalendarSystem } from "@/lib/calendar";
import { computeRecognitionDate, computeDueDate, periodKeyAndLabel } from "./schedule";

const round2 = (n: number) => Math.round(n * 100) / 100;

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

// How far past today to schedule forecast occurrences — matches the compliance
// engine's own default lookahead (src/lib/compliance/engine/generate.ts).
const MONTHS_AHEAD = 2;
// A generous safety cap on periods walked per recurring expense per call (20 years of
// monthly occurrences) — not a real limit, just a guard against an unbounded loop on bad data.
const MAX_PERIODS_PER_EXPANSION = 240;

/**
 * Expand every active recurring expense's schedule into `recurring_expense_instances`
 * rows (forecast only — `expenseId` stays null, per the spec's "Expected Future
 * Payment" vs. "Actual Payable" distinction) from its effective low-water mark
 * through MONTHS_AHEAD months past today. Idempotent via the
 * (recurringExpenseId, periodKey) unique index + onConflictDoNothing — the exact
 * pattern src/lib/compliance/engine/generate.ts uses for tax obligations, since this
 * app has no cron/background worker: this is meant to be called on demand,
 * safely, as often as a relevant page is visited.
 */
export async function expandRecurringExpenseSchedule(tenantId: string, calendar: CalendarSystem, todayIsoStr: string, recurringExpenseId?: string) {
  const templates = await db
    .select()
    .from(recurringExpenses)
    .where(
      recurringExpenseId
        ? and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.id, recurringExpenseId), eq(recurringExpenses.status, "active"))
        : and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.status, "active"))
    );

  const horizon = addMonths(calendar, todayIsoStr, MONTHS_AHEAD);
  const rows: (typeof recurringExpenseInstances.$inferInsert)[] = [];

  for (const template of templates) {
    let anchor = monthRange(calendar, template.effectiveFrom).from;
    for (let i = 0; i < MAX_PERIODS_PER_EXPANSION; i++) {
      if (anchor > horizon) break;
      const expenseDate = computeRecognitionDate(calendar, anchor, template.recognitionRule, template.recognitionDay);
      // Never schedule past the recurring expense's own end date or stop point.
      if (template.endDate && expenseDate > template.endDate) break;
      if (template.stoppedEffectiveDate && expenseDate >= template.stoppedEffectiveDate) break;
      if (expenseDate >= template.effectiveFrom) {
        const { periodKey, periodLabel } = periodKeyAndLabel(calendar, anchor);
        const dueDate = computeDueDate(calendar, expenseDate, template.dueRule, template.dueRuleValue);
        rows.push({ tenantId, recurringExpenseId: template.id, periodKey, periodLabel, expenseDate, dueDate, expectedAmount: template.amount });
      }
      anchor = addMonths(calendar, anchor, template.intervalMonths);
    }
  }

  if (rows.length === 0) return { scheduled: 0 };
  const inserted = await db.insert(recurringExpenseInstances).values(rows).onConflictDoNothing().returning({ id: recurringExpenseInstances.id });
  return { scheduled: inserted.length };
}

/**
 * Posts the real ledger expense for one occurrence: Dr the recurring expense's
 * category account, Cr Expense Payable — the same liability account and control-account
 * helper one-off expenses use (src/lib/ledger/expense-accounts.ts), never touching
 * Cash/Bank (spec §12: recognition is not payment). Actual settlement later goes
 * through the *existing* recordExpensePayment()/Payments-module machinery on the
 * `expenses` row this creates — nothing new needed there.
 */
async function postRecurringOccurrence(
  tenantId: string,
  userId: string,
  template: typeof recurringExpenses.$inferSelect,
  instance: typeof recurringExpenseInstances.$inferSelect
) {
  await assertPeriodOpen(tenantId, instance.expenseDate);
  const amount = round2(Number(instance.expectedAmount));
  if (!(amount > 0)) throw new Error("Recurring expense amount must be greater than zero");

  let expense: typeof expenses.$inferSelect | undefined;
  let expenseNumber = "";
  for (let attempt = 0; attempt < 5 && !expense; attempt++) {
    const existing = await db.select({ n: expenses.expenseNumber }).from(expenses).where(eq(expenses.tenantId, tenantId));
    const taken = new Set(existing.map((r) => r.n));
    expenseNumber = nextFreeInvoiceNumber(taken, (n) => `EXP-${String(n).padStart(4, "0")}`, taken.size + 1).number;
    try {
      [expense] = await db
        .insert(expenses)
        .values({
          tenantId,
          expenseNumber,
          expenseDate: instance.expenseDate,
          categoryAccountId: template.expenseAccountId,
          vendorId: template.vendorId,
          payeeName: template.payeeName,
          description: `Recurring: ${template.expenseName} (${instance.periodLabel})`,
          dueDate: instance.dueDate,
          billType: "no_bill",
          taxTreatment: "exempt",
          taxableAmount: amount.toFixed(2),
          vatAmount: "0.00",
          tdsAmount: "0.00",
          otherTaxAmount: "0.00",
          subtotal: amount.toFixed(2),
          total: amount.toFixed(2),
          amountPayable: amount.toFixed(2),
          amountPaid: "0.00",
          status: "unpaid",
        })
        .returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  if (!expense) throw new Error("Could not allocate an expense number");

  try {
    const expensePayable = await getOrCreateExpensePayableAccount(tenantId);
    const lines: PostLineInput[] = [
      { accountId: template.expenseAccountId, debitAmount: amount, description: `Recurring expense ${expenseNumber} — ${template.expenseName}` },
      { accountId: expensePayable.id, creditAmount: amount, description: `Recurring expense ${expenseNumber} — ${template.expenseName}` },
    ];
    await postJournalEntry({
      tenantId,
      entryDate: instance.expenseDate,
      sourceType: "expense",
      sourceId: expense.id,
      referenceNumber: expenseNumber,
      memo: `Recurring expense ${expenseNumber} — ${template.expenseName} (${instance.periodLabel})`,
      createdBy: userId,
      lines,
    });
  } catch (e) {
    await reverseAllActiveEntriesForSource(tenantId, expense.id, userId, "Rolled back — recurring expense could not be posted").catch(() => {});
    await db.delete(expenses).where(eq(expenses.id, expense.id));
    throw e;
  }

  await db.update(recurringExpenseInstances).set({ expenseId: expense.id, generatedAt: new Date() }).where(eq(recurringExpenseInstances.id, instance.id));

  await logAuditEvent({
    tenantId,
    userId,
    action: "recurring_expense_occurrence_generated",
    entityType: "recurring_expense_instance",
    entityId: instance.id,
    after: { recurringExpenseId: template.id, periodKey: instance.periodKey, periodLabel: instance.periodLabel, expenseId: expense.id, expenseNumber, amount },
  });
}

export type RecognitionResult = { recognized: number; skipped: { periodLabel: string; reason: string }[] };

/**
 * Recognizes every scheduled occurrence whose expenseDate has arrived and hasn't
 * been posted yet. A period a user never actually reaches (period stays closed, or
 * the recurring expense gets stopped after the occurrence was already scheduled as
 * a forecast) is skipped rather than aborting the whole batch — each occurrence is
 * independent.
 */
export async function recognizeDueOccurrences(tenantId: string, userId: string, asOfIso: string, recurringExpenseId?: string): Promise<RecognitionResult> {
  const due = await db
    .select({ instance: recurringExpenseInstances, template: recurringExpenses })
    .from(recurringExpenseInstances)
    .innerJoin(recurringExpenses, eq(recurringExpenseInstances.recurringExpenseId, recurringExpenses.id))
    .where(
      and(
        eq(recurringExpenseInstances.tenantId, tenantId),
        isNull(recurringExpenseInstances.expenseId),
        lte(recurringExpenseInstances.expenseDate, asOfIso),
        recurringExpenseId ? eq(recurringExpenseInstances.recurringExpenseId, recurringExpenseId) : undefined
      )
    )
    .orderBy(asc(recurringExpenseInstances.expenseDate));

  let recognized = 0;
  const skipped: { periodLabel: string; reason: string }[] = [];

  for (const { instance, template } of due) {
    // A stop recorded after this occurrence was already scheduled as a forecast still blocks it from posting.
    if (template.stoppedEffectiveDate && instance.expenseDate >= template.stoppedEffectiveDate) continue;

    try {
      await postRecurringOccurrence(tenantId, userId, template, instance);
      recognized++;
    } catch (e) {
      skipped.push({ periodLabel: instance.periodLabel, reason: e instanceof Error ? e.message : "Unknown error" });
    }
  }
  return { recognized, skipped };
}

/** Expand + recognize in one call — what a page visit triggers. */
export async function runRecurringExpenseEngine(tenantId: string, userId: string, calendar: CalendarSystem, todayIsoStr: string) {
  const { scheduled } = await expandRecurringExpenseSchedule(tenantId, calendar, todayIsoStr);
  const { recognized, skipped } = await recognizeDueOccurrences(tenantId, userId, todayIsoStr);
  return { scheduled, recognized, skipped };
}
