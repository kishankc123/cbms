import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { buildSuggestion, likePrefix, type ExpenseSuggestion } from "./suggestion-rules";

export * from "./suggestion-rules";

/**
 * What an expense description meant last time: found from the organization's own earlier expenses whose description starts with
 * what is typed. One small indexed query (the 200 most recent matches); voided expenses are ignored.
 */
export async function suggestForDescription(tenantId: string, typed: string): Promise<ExpenseSuggestion | null> {
  const text = typed.trim().slice(0, 120);
  if (text.length < 2) return null;
  const rows = await db
    .select({ description: expenses.description, categoryAccountId: expenses.categoryAccountId, expenseDate: expenses.expenseDate, subtotal: expenses.subtotal, expenseNumber: expenses.expenseNumber })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), ne(expenses.status, "void"), sql`lower(${expenses.description}) like ${likePrefix(text)}`))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(200);
  return buildSuggestion(
    text,
    rows.filter((r) => r.description).map((r) => ({ description: r.description!, categoryAccountId: r.categoryAccountId, expenseDate: r.expenseDate, subtotal: Number(r.subtotal), expenseNumber: r.expenseNumber })),
  );
}
