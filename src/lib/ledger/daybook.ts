import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { addDays } from "@/lib/calendar";
import { cashAccountRows } from "@/lib/dashboard/cash-flow";
import { buildDaybook, type DayEntry, type Daybook } from "./daybook-rules";

export * from "./daybook-rules";

/** One day of the business, from the ledger: see daybook-rules.ts for how the lines are sorted. */
export async function loadDaybook(tenantId: string, day: string): Promise<Daybook> {
  const accountRows = await cashAccountRows(tenantId);
  const cashAccounts = accountRows.map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const ids = cashAccounts.map((a) => a.id);
  const before = addDays(day, -1);

  const [entryRows, lineRows, balances] = await Promise.all([
    db
      .select({ id: journalEntries.id, sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId, isReversed: journalEntries.isReversed, reversalOfId: journalEntries.reversalOfId })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.entryDate, day))),
    db
      .select({ entryId: journalLines.journalEntryId, accountId: journalLines.accountId, debit: journalLines.debitAmount, credit: journalLines.creditAmount, modeName: journalLines.paymentModeName })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.entryDate, day))),
    ids.length === 0
      ? Promise.resolve([] as { accountId: string; opening: string; closing: string }[])
      : db
          .select({
            accountId: journalLines.accountId,
            opening: sql<string>`coalesce(sum(case when ${journalEntries.entryDate} <= ${before} then ${journalLines.debitAmount} - ${journalLines.creditAmount} else 0 end), 0)`,
            closing: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, ids), lte(journalEntries.entryDate, day)))
          .groupBy(journalLines.accountId),
  ]);

  const linesByEntry = new Map<string, DayEntry["lines"]>();
  for (const r of lineRows) {
    const list = linesByEntry.get(r.entryId) ?? [];
    list.push({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit), modeName: r.modeName });
    linesByEntry.set(r.entryId, list);
  }
  const entries: DayEntry[] = entryRows.map((e) => ({ ...e, lines: linesByEntry.get(e.id) ?? [] }));
  return buildDaybook({
    day,
    entries,
    cashAccounts,
    opening: Object.fromEntries(balances.map((b) => [b.accountId, Number(b.opening)])),
    closing: Object.fromEntries(balances.map((b) => [b.accountId, Number(b.closing)])),
  });
}
