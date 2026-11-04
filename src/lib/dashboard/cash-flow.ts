import { and, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, payments } from "@/db/schema";
import { addDays } from "@/lib/calendar";
import { modeAccountIds } from "@/lib/payment-modes";
import { buildCashFlow, type CashFlowResult, type CashLineGroup } from "./cash-flow-rules";

export * from "./cash-flow-rules";

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** The accounts that hold the business's money: Cash and Bank (and their sub-accounts), plus any account a payment mode points at (a wallet). */
export async function cashAccountRows(tenantId: string) {
  const [byCode, linked] = await Promise.all([
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, isActive: accounts.isActive })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), or(eq(accounts.code, "1000"), like(accounts.code, "1000.%"), eq(accounts.code, "1010"), like(accounts.code, "1010.%")))),
    modeAccountIds(tenantId),
  ]);
  const extra = [...linked].filter((id) => !byCode.some((a) => a.id === id));
  const more = extra.length > 0 ? await db.select({ id: accounts.id, code: accounts.code, name: accounts.name, isActive: accounts.isActive }).from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, extra))) : [];
  return [...byCode, ...more];
}

/** What those accounts hold at the end of a day. */
export async function cashBalanceAsOf(tenantId: string, accountIds: string[], dayIso: string): Promise<number> {
  if (accountIds.length === 0) return 0;
  const [row] = await db
    .select({ d: sql<string>`coalesce(sum(${journalLines.debitAmount}), 0)`, c: sql<string>`coalesce(sum(${journalLines.creditAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds), lte(journalEntries.entryDate, dayIso)));
  return Math.round((num(row?.d) - num(row?.c)) * 100) / 100;
}

/**
 * Money in and money out for a period, from the lines posted to cash, bank and wallet accounts: one query that groups by day and by what
 * posted the line, then the rules in cash-flow-rules.ts sort them into categories. A voided or edited entry and the entry that reversed it
 * are both left out when both fall in the period (they cancel), so a correction doesn't show as money in and money out; when only one
 * of the two is in the period it stays, which keeps opening cash + movement equal to closing cash.
 */
export async function cashFlow(tenantId: string, from: string, to: string): Promise<CashFlowResult> {
  const rows = await cashAccountRows(tenantId);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return buildCashFlow([], 0, 0, { from, to });

  const reversal = alias(journalEntries, "reversal");
  const original = alias(journalEntries, "original");

  const [groups, openingCash, closingCash] = await Promise.all([
    db
      .select({
        day: journalEntries.entryDate,
        sourceType: journalEntries.sourceType,
        paymentType: payments.paymentType,
        debit: sql<string>`sum(${journalLines.debitAmount})`,
        credit: sql<string>`sum(${journalLines.creditAmount})`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .leftJoin(reversal, eq(reversal.reversalOfId, journalEntries.id))
      .leftJoin(original, eq(original.id, journalEntries.reversalOfId))
      // A payment saves the entry it posted, so its own type (customer payment, supplier payment, salary...) is on hand.
      .leftJoin(payments, and(eq(payments.journalEntryId, journalEntries.id), eq(payments.tenantId, journalEntries.tenantId)))
      .where(
        and(
          eq(journalEntries.tenantId, tenantId),
          inArray(journalLines.accountId, ids),
          gte(journalEntries.entryDate, from),
          lte(journalEntries.entryDate, to),
          sql`not (${journalEntries.isReversed} and ${reversal.entryDate} between ${from} and ${to})`,
          sql`not (${journalEntries.reversalOfId} is not null and ${original.entryDate} between ${from} and ${to})`
        )
      )
      .groupBy(journalEntries.entryDate, journalEntries.sourceType, payments.paymentType),
    cashBalanceAsOf(tenantId, ids, addDays(from, -1)),
    cashBalanceAsOf(tenantId, ids, to),
  ]);

  const lines: CashLineGroup[] = groups.map((g) => ({ day: g.day, sourceType: g.sourceType, paymentType: g.paymentType, debit: num(g.debit), credit: num(g.credit) }));
  return buildCashFlow(lines, openingCash, closingCash, { from, to });
}
