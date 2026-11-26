import { and, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, journalEntries, journalLines, payments } from "@/db/schema";

// The expense payables (Expense Payable and each recurring expense's own account under Recurring Payable) are kept by the app, so a payment normally clears them
// by settling the expense bill. But what was owed before the books started (an opening balance, or a journal) has no bill to settle. That part, and only that
// part, can be paid straight to the account: what the account owes in the books, less what its unpaid expense bills account for.

const EXPENSE_PAYABLE_CODE = "2340";
const RECURRING_PAYABLE_CODE = "2345";
const round2 = (n: number) => Math.round(n * 100) / 100;

export type OpenPayable = { id: string; code: string; name: string; group: string | null; groupCode: string | null; /** what is owed there with no expense bill behind it */ unbilled: number };

/**
 * The expense payables with something owed that no bill covers. `excludePaymentId` is a payment being edited: what it already paid to the account counts
 * as still available to it.
 */
export async function openPayables(tenantId: string, opts: { excludePaymentId?: string } = {}): Promise<OpenPayable[]> {
  const all = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name, parentId: accounts.parentAccountId }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.isActive, true)));
  const hasChildren = new Set(all.map((a) => a.parentId).filter((x): x is string => Boolean(x)));
  const group = all.find((a) => a.code === RECURRING_PAYABLE_CODE);
  const expensePayable = all.find((a) => a.code === EXPENSE_PAYABLE_CODE);
  const candidates = all.filter((a) => !hasChildren.has(a.id) && ((group && a.parentId === group.id) || a.id === expensePayable?.id));
  if (candidates.length === 0) return [];
  const ids = candidates.map((a) => a.id);

  const [booked, billed, own] = await Promise.all([
    db
      .select({ accountId: journalLines.accountId, owed: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(and(eq(journalEntries.tenantId, tenantId), or(...ids.map((id) => eq(journalLines.accountId, id)))))
      .groupBy(journalLines.accountId),
    // An expense with no account of its own is owed on Expense Payable.
    db
      .select({ accountId: expenses.payableAccountId, unpaid: sql<string>`coalesce(sum(${expenses.amountPayable} - ${expenses.amountPaid}), 0)` })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), ne(expenses.status, "void")))
      .groupBy(expenses.payableAccountId),
    opts.excludePaymentId
      ? db.select({ accountId: payments.categoryAccountId, amount: payments.amount, status: payments.status }).from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.id, opts.excludePaymentId)))
      : Promise.resolve([] as { accountId: string | null; amount: string; status: string }[]),
  ]);

  const owedOn = new Map(booked.map((b) => [b.accountId, Number(b.owed)]));
  const unpaidOn = new Map<string, number>();
  for (const b of billed) {
    const key = b.accountId ?? expensePayable?.id;
    if (key) unpaidOn.set(key, (unpaidOn.get(key) ?? 0) + Number(b.unpaid));
  }
  return candidates
    .map((a) => {
      const back = own.find((p) => p.accountId === a.id && p.status === "posted");
      const unbilled = round2((owedOn.get(a.id) ?? 0) - (unpaidOn.get(a.id) ?? 0) + (back ? Number(back.amount) : 0));
      const parent = a.parentId && group && a.parentId === group.id ? group : null;
      return { id: a.id, code: a.code, name: a.name, group: parent?.name ?? null, groupCode: parent?.code ?? null, unbilled };
    })
    .filter((a) => a.unbilled > 0.005)
    .sort((x, y) => x.code.localeCompare(y.code));
}
