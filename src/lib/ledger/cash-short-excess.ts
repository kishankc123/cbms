import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts, cashDifferenceExplanations, expenses } from "@/db/schema";
import { findControlAccount } from "./control-accounts";
import { SHORT_EXCESS_CODE, SHORT_EXCESS_NAME } from "./cash-reconcile-rules";

// The one account that short and excess cash goes to, so a short today and an excess tomorrow net off. Created the first time it is needed.

export async function findShortExcessAccount(tenantId: string) {
  return findControlAccount(tenantId, [SHORT_EXCESS_CODE], SHORT_EXCESS_NAME);
}

export async function getOrCreateShortExcessAccount(tenantId: string) {
  const existing = await findShortExcessAccount(tenantId);
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: SHORT_EXCESS_CODE, name: SHORT_EXCESS_NAME, category: "expense", subCategory: "Indirect expenses" })
    .returning();
  return created;
}

/** True for an expense that was recorded to explain a cash shortage: it is settled from the short and excess account, not from cash or bank. */
export async function isExplainingExpense(tenantId: string, expenseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: cashDifferenceExplanations.id })
    .from(cashDifferenceExplanations)
    .innerJoin(expenses, eq(expenses.id, cashDifferenceExplanations.expenseId))
    .where(and(eq(cashDifferenceExplanations.tenantId, tenantId), eq(cashDifferenceExplanations.expenseId, expenseId), eq(expenses.tenantId, tenantId), ne(expenses.status, "void")))
    .limit(1);
  return Boolean(row);
}
