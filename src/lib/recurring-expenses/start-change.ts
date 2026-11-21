import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { expenses, recurringExpenseInstances } from "@/db/schema";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertSourceNotReconciled } from "@/lib/ledger/reconciliation-guards";
import { voidExpenseCore } from "@/lib/expenses/void-expense";

// Moving a recurring expense's start date moves the date the schedule is built from. A start that is moved back makes the earlier months
// appear (the engine books them next time it runs); a start that is moved forward drops the months before it. Months that were only forecasts just
// go away; months already booked as real expenses are left alone unless the person chooses to void them.

type Dates = { startDate: string; effectiveFrom: string };

/** The date the schedule is built from after the start date is changed. A paused-and-resumed expense keeps its resume date unless the new start is later. */
export function newEffectiveFrom(existing: Dates, newStart: string): string {
  if (existing.effectiveFrom === existing.startDate) return newStart;
  return newStart > existing.effectiveFrom ? newStart : existing.effectiveFrom;
}

export type BookedBefore = { instanceId: string; expenseId: string; expenseNumber: string; periodLabel: string; expenseDate: string; amount: number; voidable: boolean; blockedReason: string | null };

/** Why a booked occurrence cannot be voided here, or null when it can. */
async function blockedReason(tenantId: string, expense: { id: string; amountPaid: string; expenseDate: string }): Promise<string | null> {
  if (Number(expense.amountPaid) > 0) return "A payment was made against it. Void that payment first.";
  try {
    await assertPeriodOpen(tenantId, expense.expenseDate);
    await assertSourceNotReconciled(tenantId, expense.id, "expense");
  } catch (e) {
    return e instanceof Error ? e.message : "It is locked.";
  }
  return null;
}

/** The occurrences already booked as expenses that fall before `cutoff` (the new effective date), and whether each can be voided. */
export async function bookedBefore(tenantId: string, recurringExpenseId: string, cutoff: string): Promise<BookedBefore[]> {
  const rows = await db
    .select({ instance: recurringExpenseInstances, expense: expenses })
    .from(recurringExpenseInstances)
    .innerJoin(expenses, eq(expenses.id, recurringExpenseInstances.expenseId))
    .where(and(eq(recurringExpenseInstances.tenantId, tenantId), eq(recurringExpenseInstances.recurringExpenseId, recurringExpenseId), lt(recurringExpenseInstances.expenseDate, cutoff)))
    .orderBy(asc(recurringExpenseInstances.expenseDate));
  const out: BookedBefore[] = [];
  for (const { instance, expense } of rows) {
    if (expense.status === "void") continue;
    const reason = await blockedReason(tenantId, expense);
    out.push({ instanceId: instance.id, expenseId: expense.id, expenseNumber: expense.expenseNumber, periodLabel: instance.periodLabel, expenseDate: instance.expenseDate, amount: Number(instance.expectedAmount), voidable: reason === null, blockedReason: reason });
  }
  return out;
}

/**
 * Applies a move of the start date to the schedule: forecasts before the new effective date are dropped, and the booked occurrences the person chose
 * are voided (and their schedule rows removed, so moving the start back later books them again). Everything is checked before anything is changed.
 */
export async function applyStartChange(tenantId: string, userId: string, recurringExpenseId: string, cutoff: string, voidInstanceIds: string[]) {
  if (voidInstanceIds.length > 0) {
    const booked = await bookedBefore(tenantId, recurringExpenseId, cutoff);
    for (const id of voidInstanceIds) {
      const b = booked.find((x) => x.instanceId === id);
      if (!b) throw new Error("One of the months chosen is no longer booked before the new start date. Open the edit again.");
      if (!b.voidable) throw new Error(`${b.periodLabel} (${b.expenseNumber}) can't be voided: ${b.blockedReason}`);
    }
    for (const id of voidInstanceIds) {
      const b = booked.find((x) => x.instanceId === id)!;
      await voidExpenseCore(tenantId, userId, b.expenseId);
      await db.delete(recurringExpenseInstances).where(and(eq(recurringExpenseInstances.id, id), eq(recurringExpenseInstances.tenantId, tenantId)));
    }
  }
  // Forecasts that were never booked and now fall before the start.
  await db
    .delete(recurringExpenseInstances)
    .where(and(eq(recurringExpenseInstances.tenantId, tenantId), eq(recurringExpenseInstances.recurringExpenseId, recurringExpenseId), isNull(recurringExpenseInstances.expenseId), lt(recurringExpenseInstances.expenseDate, cutoff)));
}
