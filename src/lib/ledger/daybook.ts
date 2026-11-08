import { and, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { issuedCheques, journalEntries, journalLines, payments, receivedCheques } from "@/db/schema";
import { addDays } from "@/lib/calendar";
import { cashAccountRows } from "@/lib/dashboard/cash-flow";
import { buildDaybook, type DayEntry, type Daybook } from "./daybook-rules";
import { buildRange, type DaybookRange, type RangeEntry } from "./daybook-range";
import { buildDayCheques, type DayChequeRow, type DayCheques } from "./daybook-cheques";
import { buildDayList, creditOfDay, flowRows, FLOW_TYPES, type FlowRow, type ListEntry, type ListRow, type MonthTotals } from "./daybook-extras";

export * from "./daybook-rules";
export * from "./daybook-extras";
export * from "./daybook-range";
export * from "./daybook-cheques";

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

export type DaybookPage = { book: Daybook; month: MonthTotals; flows: FlowRow[]; credit: { given: number; taken: number }; list: ListRow[]; listHidden: number; cheques: DayCheques };

/** What the Daybook page shows: the day, the month so far, collections and payments, the credit given and taken, the cheques, and the day's entries. `monthFrom` is the first day of the month in the organization's calendar. */
export async function loadDaybookPage(tenantId: string, day: string, today: string = day, monthFrom: string = day): Promise<DaybookPage> {
  const accountRows = await cashAccountRows(tenantId);
  const cashAccounts = accountRows.map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const [now, cheques, month, flows] = await Promise.all([readDay(tenantId, day, cashAccounts), loadDayCheques(tenantId, day, today), loadDaybookRange(tenantId, monthFrom, day), loadFlows(tenantId, day, monthFrom)]);
  const { rows, hidden } = buildDayList(now.entries, new Set(cashAccounts.map((a) => a.id)));
  const t = month.total;
  return {
    book: now.book,
    month: { from: month.from, sales: t.sales.total, purchases: t.purchases.total, expenses: t.expenses.total, moneyIn: t.moneyIn, moneyOut: t.moneyOut },
    flows,
    credit: creditOfDay(now.book),
    list: rows,
    listHidden: hidden,
    cheques,
  };
}

/** Customer credit recovered, supplier payments, salaries and staff advances: what was paid on the day and in the month so far, from the posted payments. */
export async function loadFlows(tenantId: string, day: string, monthFrom: string): Promise<FlowRow[]> {
  const rows = await db
    .select({
      type: payments.paymentType,
      today: sql<string>`coalesce(sum(case when ${payments.paymentDate} = ${day} then ${payments.amount} else 0 end), 0)`,
      month: sql<string>`coalesce(sum(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.status, "posted"), eq(payments.origin, "standalone"), gte(payments.paymentDate, monthFrom), lte(payments.paymentDate, day), inArray(payments.paymentType, FLOW_TYPES.map((f) => f.type))))
    .groupBy(payments.paymentType);
  return flowRows(rows.map((r) => ({ type: r.type, today: Number(r.today), month: Number(r.month) })));
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

const nepalDay = (col: unknown) => sql<string>`to_char(${col} at time zone 'Asia/Kathmandu', 'YYYY-MM-DD')`;

/** The cheques that matter on a day, from the issued and received registers (see daybook-cheques.ts). */
export async function loadDayCheques(tenantId: string, day: string, today: string): Promise<DayCheques> {
  const closedIssued = ["bounced", "stopped"];
  const closedReceived = ["bounced", "returned"];
  const [issued, received] = await Promise.all([
    db
      .select({ id: issuedCheques.id, number: issuedCheques.chequeNumber, party: issuedCheques.payeeName, amount: issuedCheques.amount, chequeDate: issuedCheques.chequeDate, status: issuedCheques.status, clearedDate: issuedCheques.clearedDate, closedOn: nepalDay(issuedCheques.updatedAt) })
      .from(issuedCheques)
      .where(
        and(
          eq(issuedCheques.tenantId, tenantId),
          or(
            eq(issuedCheques.chequeDate, day),
            eq(issuedCheques.clearedDate, day),
            and(inArray(issuedCheques.status, closedIssued), sql`${nepalDay(issuedCheques.updatedAt)} = ${day}`),
            day === today ? and(eq(issuedCheques.status, "issued"), lt(issuedCheques.chequeDate, day)) : undefined,
          ),
        ),
      ),
    db
      .select({ id: receivedCheques.id, number: receivedCheques.chequeNumber, party: receivedCheques.payerName, amount: receivedCheques.amount, chequeDate: receivedCheques.chequeDate, status: receivedCheques.status, clearedDate: receivedCheques.clearedDate, depositedDate: receivedCheques.depositedDate, closedOn: nepalDay(receivedCheques.updatedAt) })
      .from(receivedCheques)
      .where(
        and(
          eq(receivedCheques.tenantId, tenantId),
          or(
            eq(receivedCheques.chequeDate, day),
            eq(receivedCheques.clearedDate, day),
            eq(receivedCheques.depositedDate, day),
            and(inArray(receivedCheques.status, closedReceived), sql`${nepalDay(receivedCheques.updatedAt)} = ${day}`),
            day === today ? and(eq(receivedCheques.status, "received"), lt(receivedCheques.chequeDate, day)) : undefined,
          ),
        ),
      ),
  ]);
  const closedOn = (status: string, closed: string[], on: string) => (closed.includes(status) ? on : null);
  const rows: DayChequeRow[] = [
    ...issued.map((c): DayChequeRow => ({ id: c.id, kind: "issued", number: c.number, party: c.party, amount: Number(c.amount), chequeDate: c.chequeDate, status: c.status, open: c.status === "issued", clearedDate: c.clearedDate, depositedDate: null, closedOn: closedOn(c.status, closedIssued, c.closedOn) })),
    ...received.map((c): DayChequeRow => ({ id: c.id, kind: "received", number: c.number, party: c.party, amount: Number(c.amount), chequeDate: c.chequeDate, status: c.status, open: c.status === "received", clearedDate: c.clearedDate, depositedDate: c.depositedDate, closedOn: closedOn(c.status, closedReceived, c.closedOn) })),
  ];
  return buildDayCheques(rows, day, today);
}
