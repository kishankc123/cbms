import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";

/**
 * How each expense was paid, for the expense list: the payment mode of every payment made against it, whether it was paid when
 * entered or later. Read from the cash, bank and wallet lines of the expense's own entries (never the reversals of edited or
 * voided ones). A payment made before modes existed shows the account it came out of instead.
 */
export async function paymentModesByExpense(tenantId: string, expenseIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (expenseIds.length === 0) return out;
  const cashIds = (await getCashBankAccounts(tenantId)).flatMap((g) => [g.id, ...g.children.map((c) => c.id)]);
  if (cashIds.length === 0) return out;

  const rows = await db
    .select({ expenseId: journalEntries.sourceId, mode: journalLines.paymentModeName, account: accounts.name })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        inArray(journalEntries.sourceType, ["expense", "payment"]),
        eq(journalEntries.isReversed, false),
        isNull(journalEntries.reversalOfId),
        inArray(journalEntries.sourceId, expenseIds),
        inArray(journalLines.accountId, cashIds),
        gt(journalLines.creditAmount, "0")
      )
    )
    .orderBy(asc(journalEntries.createdAt));
  for (const r of rows) {
    if (!r.expenseId) continue;
    const label = r.mode ?? r.account;
    const list = (out[r.expenseId] ??= []);
    if (!list.includes(label)) list.push(label);
  }
  return out;
}
