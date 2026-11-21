import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { expenses, payments, paymentAllocations } from "@/db/schema";
import { reverseAllActiveEntriesForSource } from "@/lib/ledger/post";
import { assertSourceNotReconciled } from "@/lib/ledger/reconciliation-guards";

// Marks every Payment-module row recorded for this expense as voided (without reversing their journal entries again: reverseAllActiveEntriesForSource has
// already reversed the underlying entries) so the Payments list reflects the expense's void immediately.
async function voidPaymentsForExpense(tenantId: string, expenseId: string, userId: string, reason: string) {
  const rows = await db
    .select({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(paymentAllocations.targetType, "expense"), eq(paymentAllocations.targetId, expenseId), ne(payments.status, "voided")));
  for (const id of [...new Set(rows.map((r) => r.paymentId))]) {
    await db.update(payments).set({ status: "voided", voidReason: reason, voidedBy: userId, voidedAt: new Date() }).where(and(eq(payments.id, id), eq(payments.tenantId, tenantId)));
  }
}

/** Voids one expense: its entries are reversed, its payments marked voided and its status set to void. The caller checks permission. */
export async function voidExpenseCore(tenantId: string, userId: string, expenseId: string) {
  const [expense] = await db.select().from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, tenantId))).limit(1);
  if (!expense) throw new Error("Expense not found");
  if (expense.status === "void") throw new Error("Expense is already void");
  await assertSourceNotReconciled(tenantId, expenseId, "expense");
  await reverseAllActiveEntriesForSource(tenantId, expenseId, userId, `Void of expense ${expense.expenseNumber}`);
  await voidPaymentsForExpense(tenantId, expenseId, userId, `Void of expense ${expense.expenseNumber}`);
  await db.update(expenses).set({ status: "void" }).where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, tenantId)));
  return expense;
}
