import { and, count, eq, inArray, lt, min, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets, journalEntries, journalLines, stockMovements, tenants } from "@/db/schema";
import { formatDate, type CalendarSystem } from "@/lib/calendar";
import { logAuditEvent } from "@/lib/audit";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertFiscalYearOpen, resolveFiscalYearId } from "@/lib/fiscal";
import { assertBankPeriodOpen } from "./reconciliation-guards";

// The books start date is the one date the books begin on: the opening balances are posted on it, nothing may be dated before it, and reports start from it.
// It is stored as the organization's opening balance date (blank = not set: then there is no floor and the fiscal year start stands in for it).

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function getBooksStart(tenantId: string): Promise<{ date: string | null; calendar: CalendarSystem }> {
  const [t] = await db.select({ date: tenants.openingBalanceDate, calendar: tenants.calendarSystem }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return { date: t?.date ?? null, calendar: t?.calendar === "BS" ? "BS" : "AD" };
}

/**
 * A report cannot show days before the books began: a range that starts before the books start date starts on it, and the opening balances are then the
 * report's opening line. `beforeBooks` is a range that ends before the books start (it will be empty). Pure.
 */
export function clampToBooksStart(range: { from: string; to: string }, booksStart: string | null): { from: string; to: string; clamped: boolean; beforeBooks: boolean } {
  if (!booksStart || range.from >= booksStart) return { ...range, clamped: false, beforeBooks: false };
  if (range.to < booksStart) return { ...range, clamped: false, beforeBooks: true };
  return { from: booksStart, to: range.to, clamped: true, beforeBooks: false };
}

/** Refuses a date before the books start, in plain words. A blank books start date means there is no floor. */
export async function assertNotBeforeBooksStart(tenantId: string, entryDate: string): Promise<void> {
  const { date, calendar } = await getBooksStart(tenantId);
  if (date && entryDate < date) {
    throw new Error(`${formatDate(entryDate, calendar, "long")} is before your books start on ${formatDate(date, calendar, "long")}. Use a date on or after it, or change the books start date in Settings > Opening balances.`);
  }
}

/**
 * Moves the books start date. The opening balances are all dated on it, so they move with it, in one step; a customer's, a supplier's, a bank's or the general
 * opening balance keep their amounts and only their date changes. Refused, in plain words, when the move would leave something stranded:
 *  - an entry other than an opening balance is dated before the new date (the books cannot start after their own transactions);
 *  - opening assets or opening stock exist (their depreciation and stock history are worked out as of the old date);
 *  - the month, fiscal year or bank reconciliation of the old or the new date is closed.
 */
export async function changeBooksStartDate(tenantId: string, userId: string, newDate: string): Promise<{ moved: number }> {
  if (!ISO.test(newDate) || Number.isNaN(Date.parse(newDate))) throw new Error("Choose the books start date");
  const [t] = await db.select({ date: tenants.openingBalanceDate, calendar: tenants.calendarSystem }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) throw new Error("Organization not found");
  const calendar: CalendarSystem = t.calendar === "BS" ? "BS" : "AD";
  const oldDate = t.date;
  if (oldDate === newDate) return { moved: 0 };
  const say = (iso: string) => formatDate(iso, calendar, "long");

  const openings = await db
    .select({ id: journalEntries.id, entryDate: journalEntries.entryDate })
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "opening_balance")));

  // Opening balances already dated on the new date (the date is only being recorded) have nothing to move, so none of the checks below apply.
  if (openings.some((o) => o.entryDate !== newDate)) {
    const [earlier] = await db
      .select({ first: min(journalEntries.entryDate) })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, tenantId), ne(journalEntries.sourceType, "opening_balance"), lt(journalEntries.entryDate, newDate)));
    if (earlier?.first) throw new Error(`There are entries dated ${say(earlier.first)}, which is before ${say(newDate)}. The books can't start after their own transactions: choose ${say(earlier.first)} or an earlier date.`);

    const [openAssets] = await db.select({ n: count() }).from(assets).where(and(eq(assets.tenantId, tenantId), eq(assets.source, "opening"), ne(assets.status, "voided")));
    if (openAssets.n > 0) throw new Error("Opening assets are worked out as of the current books start date, so it can't be moved while they exist. Void the opening assets, change the date, and enter them again.");
    const [openStock] = await db.select({ n: count() }).from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.sourceType, "opening")));
    if (openStock.n > 0) throw new Error("Opening stock is dated to the current books start date, so it can't be moved while it exists. Remove the opening stock (Inventory > Stock > Opening), change the date, and enter it again.");

    // Closed months, closed fiscal years and reconciled bank periods on either date.
    const accountIds = [...new Set((await db.select({ accountId: journalLines.accountId }).from(journalLines).where(inArray(journalLines.journalEntryId, openings.map((o) => o.id)))).map((l) => l.accountId))];
    for (const day of new Set([...openings.map((o) => o.entryDate), newDate])) {
      try {
        await assertPeriodOpen(tenantId, day);
        await assertFiscalYearOpen(tenantId, day);
        await assertBankPeriodOpen(tenantId, day, accountIds);
      } catch (e) {
        throw new Error(`The opening balances can't be moved because ${say(day)} is in a closed period: ${e instanceof Error ? e.message : "it is locked"}`);
      }
    }
  }

  const toMove = openings.filter((o) => o.entryDate !== newDate);
  const fiscalYearId = toMove.length > 0 ? await resolveFiscalYearId(tenantId, newDate) : null;
  await db.transaction(async (tx) => {
    if (toMove.length > 0) await tx.update(journalEntries).set({ entryDate: newDate, fiscalYearId }).where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "opening_balance")));
    await tx.update(tenants).set({ openingBalanceDate: newDate }).where(eq(tenants.id, tenantId));
  });
  await logAuditEvent({ tenantId, userId, action: "books_start_date_changed", entityType: "tenant", entityId: tenantId, before: { date: oldDate }, after: { date: newDate, openingEntriesMoved: toMove.length } });
  return { moved: toMove.length };
}
