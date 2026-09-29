import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses, recurringExpenseInstances, expenses } from "@/db/schema";

export type RecurringExpenseHistoryPeriod = {
  id: string;
  periodKey: string;
  periodLabel: string;
  expenseDate: string;
  dueDate: string | null;
  expectedAmount: number;
  expenseId: string | null;
  expenseNumber: string | null;
  amountPaid: number | null;
  remaining: number | null;
  status: "expected" | "unpaid" | "partially_paid" | "paid" | "void";
};

/** One recurring expense's full schedule, each period's REAL posted status where one exists
 * (spec §15/§16 — a period not yet reached stays "Expected"; once posted, everything about it,
 * including history, comes from the real `expenses` row, never a second copy). */
export async function getRecurringExpenseHistory(tenantId: string, recurringExpenseId: string) {
  const [recurring] = await db
    .select()
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.id, recurringExpenseId)))
    .limit(1);
  if (!recurring) return null;

  const rows = await db
    .select({ instance: recurringExpenseInstances, expense: expenses })
    .from(recurringExpenseInstances)
    .leftJoin(expenses, eq(recurringExpenseInstances.expenseId, expenses.id))
    .where(and(eq(recurringExpenseInstances.tenantId, tenantId), eq(recurringExpenseInstances.recurringExpenseId, recurringExpenseId)))
    .orderBy(asc(recurringExpenseInstances.periodKey));

  const periods: RecurringExpenseHistoryPeriod[] = rows.map(({ instance, expense }) => ({
    id: instance.id,
    periodKey: instance.periodKey,
    periodLabel: instance.periodLabel,
    expenseDate: instance.expenseDate,
    dueDate: instance.dueDate,
    expectedAmount: Number(instance.expectedAmount),
    expenseId: instance.expenseId,
    expenseNumber: expense?.expenseNumber ?? null,
    amountPaid: expense ? Number(expense.amountPaid) : null,
    remaining: expense ? Math.round((Number(expense.amountPayable) - Number(expense.amountPaid)) * 100) / 100 : null,
    status: expense ? expense.status : "expected",
  }));

  return { recurring, periods };
}
