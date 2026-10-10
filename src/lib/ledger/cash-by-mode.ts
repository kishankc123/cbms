import { and, eq, gte, inArray, isNull, like, lte, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { modeAccountIds } from "@/lib/payment-modes";
import { groupByMode } from "./cash-by-mode-rules";

export { groupByMode, NO_MODE_LABEL, type ModeLine, type ModeRow, type ModeAccountRow } from "./cash-by-mode-rules";

/**
 * Money received and paid through each payment mode in a period, from the lines posted to cash, bank and wallet accounts. Entries that
 * were voided or edited (and the entries that reversed them) are left out, as are moves between the business's own accounts
 * (Inter-Transfers), which are neither a receipt nor a payment. The mode is the one saved with each line.
 */
export async function cashByMode(tenantId: string, from: string, to: string) {
  const [cashBank, linked] = await Promise.all([
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), or(eq(accounts.code, "1000"), like(accounts.code, "1000.%"), eq(accounts.code, "1010"), like(accounts.code, "1010.%")))),
    modeAccountIds(tenantId),
  ]);
  const accountIds = [...new Set([...cashBank.map((a) => a.id), ...linked])];
  if (accountIds.length === 0) return { ...groupByMode([]), accountNames: new Map<string, string>() };

  const rows = await db
    .select({ entryId: journalEntries.id, accountId: journalLines.accountId, modeName: journalLines.paymentModeName, debit: journalLines.debitAmount, credit: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        inArray(journalLines.accountId, accountIds),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
        eq(journalEntries.isReversed, false),
        isNull(journalEntries.reversalOfId),
        ne(journalEntries.sourceType, "inter_transfer")
      )
    );

  const names = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, accountIds)));
  return {
    ...groupByMode(rows.map((r) => ({ modeName: r.modeName, accountId: r.accountId, entryId: r.entryId, debit: Number(r.debit), credit: Number(r.credit) }))),
    accountNames: new Map(names.map((a) => [a.id, `${a.code} — ${a.name}`])),
  };
}
