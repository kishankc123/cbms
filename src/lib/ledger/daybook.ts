import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { addDays } from "@/lib/calendar";
import { cashAccountRows } from "@/lib/dashboard/cash-flow";
import { buildDaybook, type DayEntry, type Daybook } from "./daybook-rules";
import { buildRange, type DaybookRange, type RangeEntry } from "./daybook-range";
import { buildDayList, compareDays, creditOfDay, type CompareRow, type ListEntry, type ListRow } from "./daybook-extras";

export * from "./daybook-rules";
export * from "./daybook-extras";
export * from "./daybook-range";

type CashAccounts = { id: string; code: string; name: string }[];

async function readDay(tenantId: string, day: string, cashAccounts: CashAccounts): Promise<{ book: Daybook; entries: ListEntry[] }> {
  const ids = cashAccounts.map((a) => a.id);
  const before = addDays(day, -1);

  const [entryRows, lineRows, balances] = await Promise.all([
    db
      .select({
        id: journalEntries.id,
        sourceType: journalEntries.sourceType,
        sourceId: journalEntries.sourceId,
        isReversed: journalEntries.isReversed,
        reversalOfId: journalEntries.reversalOfId,
        reference: journalEntries.referenceNumber,
        memo: journalEntries.memo,
        createdAt: journalEntries.createdAt,
      })
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
  const entries: ListEntry[] = entryRows.map((e) => ({
    id: e.id,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    isReversed: e.isReversed,
    reversalOfId: e.reversalOfId,
    reference: e.reference,
    memo: e.memo,
    createdAt: e.createdAt.toISOString(),
    lines: linesByEntry.get(e.id) ?? [],
  }));
  const book = buildDaybook({
    day,
    entries,
    cashAccounts,
    opening: Object.fromEntries(balances.map((b) => [b.accountId, Number(b.opening)])),
    closing: Object.fromEntries(balances.map((b) => [b.accountId, Number(b.closing)])),
  });
  return { book, entries };
}

/** One day of the business, from the ledger: see daybook-rules.ts for how the lines are sorted. */
export async function loadDaybook(tenantId: string, day: string): Promise<Daybook> {
  const accountRows = await cashAccountRows(tenantId);
  return (await readDay(tenantId, day, accountRows.map((a) => ({ id: a.id, code: a.code, name: a.name })))).book;
}

export type DaybookPage = { book: Daybook; compare: CompareRow[]; compareDay: string; credit: { given: number; taken: number }; list: ListRow[]; listHidden: number };

/** What the Daybook page shows: the day, how it compares with the same weekday a week earlier, the credit given and taken, and the day's entries. */
export async function loadDaybookPage(tenantId: string, day: string): Promise<DaybookPage> {
  const accountRows = await cashAccountRows(tenantId);
  const cashAccounts = accountRows.map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const compareDay = addDays(day, -7);
  const [now, then] = await Promise.all([readDay(tenantId, day, cashAccounts), readDay(tenantId, compareDay, cashAccounts)]);
  const { rows, hidden } = buildDayList(now.entries, new Set(cashAccounts.map((a) => a.id)));
  return { book: now.book, compare: compareDays(now.book, then.book), compareDay, credit: creditOfDay(now.book), list: rows, listHidden: hidden };
}

/** The Daybook for a stretch of days (see daybook-range.ts): three queries however long the stretch is. */
export async function loadDaybookRange(tenantId: string, from: string, to: string): Promise<DaybookRange> {
  const accountRows = await cashAccountRows(tenantId);
  const cashAccounts = accountRows.map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const ids = cashAccounts.map((a) => a.id);
  const inRange = and(eq(journalEntries.tenantId, tenantId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to));

  const [entryRows, lineRows, balances] = await Promise.all([
    db.select({ id: journalEntries.id, date: journalEntries.entryDate, sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId, isReversed: journalEntries.isReversed, reversalOfId: journalEntries.reversalOfId }).from(journalEntries).where(inRange),
    db
      .select({ entryId: journalLines.journalEntryId, accountId: journalLines.accountId, debit: journalLines.debitAmount, credit: journalLines.creditAmount, modeName: journalLines.paymentModeName })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(inRange),
    ids.length === 0
      ? Promise.resolve([] as { accountId: string; balance: string }[])
      : db
          .select({ accountId: journalLines.accountId, balance: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, ids), lt(journalEntries.entryDate, from)))
          .groupBy(journalLines.accountId),
  ]);

  const linesByEntry = new Map<string, DayEntry["lines"]>();
  for (const r of lineRows) {
    const list = linesByEntry.get(r.entryId) ?? [];
    list.push({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit), modeName: r.modeName });
    linesByEntry.set(r.entryId, list);
  }
  const entries: RangeEntry[] = entryRows.map((e) => ({ ...e, lines: linesByEntry.get(e.id) ?? [] }));
  return buildRange({ from, to, entries, cashAccounts, openingBefore: Object.fromEntries(balances.map((b) => [b.accountId, Number(b.balance)])) });
}
