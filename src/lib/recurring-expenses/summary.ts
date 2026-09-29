import { and, eq, gte, lte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses, recurringExpenseInstances, expenses } from "@/db/schema";
import { addDays, monthRange, type CalendarSystem } from "@/lib/calendar";

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export type RecurringExpenseSummary = {
  activeCount: number;
  expectedThisMonth: number;
  expectedNext30Days: number;
  outstandingLiabilities: number;
  overdueCount: number;
  overdueAmount: number;
};

/** The five summary cards atop the Recurring Expenses list (spec §3.1). "Expected"
 * figures read the schedule (recurring_expense_instances — forecast + already-posted
 * alike); "Outstanding"/"Overdue" read the real `expenses` rows a period has been
 * posted to, since those are the actual liability, not a forecast. */
export async function getRecurringExpenseSummary(tenantId: string, calendar: CalendarSystem, todayIso: string): Promise<RecurringExpenseSummary> {
  const monthRangeIso = monthRange(calendar, todayIso);
  const next30 = addDays(todayIso, 30);

  const [[activeRow], [thisMonthRow], [next30Row], [outstandingRow], [overdueRow]] = await Promise.all([
    db.select({ n: sql<string>`count(*)` }).from(recurringExpenses).where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.status, "active"))),
    db
      .select({ total: sql<string>`coalesce(sum(${recurringExpenseInstances.expectedAmount}), 0)` })
      .from(recurringExpenseInstances)
      .where(and(eq(recurringExpenseInstances.tenantId, tenantId), gte(recurringExpenseInstances.expenseDate, monthRangeIso.from), lte(recurringExpenseInstances.expenseDate, monthRangeIso.to))),
    db
      .select({ total: sql<string>`coalesce(sum(${recurringExpenseInstances.expectedAmount}), 0)` })
      .from(recurringExpenseInstances)
      .where(and(eq(recurringExpenseInstances.tenantId, tenantId), gte(recurringExpenseInstances.expenseDate, todayIso), lte(recurringExpenseInstances.expenseDate, next30))),
    db
      .select({ total: sql<string>`coalesce(sum(${expenses.amountPayable} - ${expenses.amountPaid}), 0)` })
      .from(expenses)
      .innerJoin(recurringExpenseInstances, eq(recurringExpenseInstances.expenseId, expenses.id))
      .where(and(eq(expenses.tenantId, tenantId), sql`${expenses.status} in ('unpaid', 'partially_paid')`)),
    db
      .select({ n: sql<string>`count(*)`, total: sql<string>`coalesce(sum(${expenses.amountPayable} - ${expenses.amountPaid}), 0)` })
      .from(expenses)
      .innerJoin(recurringExpenseInstances, eq(recurringExpenseInstances.expenseId, expenses.id))
      .where(and(eq(expenses.tenantId, tenantId), sql`${expenses.status} in ('unpaid', 'partially_paid')`, isNotNull(expenses.dueDate), sql`${expenses.dueDate} < ${todayIso}`)),
  ]);

  return {
    activeCount: Number(activeRow?.n ?? 0),
    expectedThisMonth: round2(num(thisMonthRow?.total)),
    expectedNext30Days: round2(num(next30Row?.total)),
    outstandingLiabilities: round2(num(outstandingRow?.total)),
    overdueCount: Number(overdueRow?.n ?? 0),
    overdueAmount: round2(num(overdueRow?.total)),
  };
}
