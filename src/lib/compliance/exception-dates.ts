import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bankStatementLines, expenses, journalEntries, purchaseBills } from "@/db/schema";

// Which fiscal year an exception belongs to. An exception is about something that happened on a date (two bills with the same number, a
// bank line nobody matched, a journal entry that breaks a rule), and that date is what puts it in a year — not the day the scan found it.
// An exception about something with no date of its own (a supplier, a bank account) falls back to the day it was found.

type Row = { id: string; transactionType: string | null; transactionId: string | null; detectedDate: Date };

const ids = (row: Row) => (row.transactionId ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** The date each exception is about (YYYY-MM-DD), keyed by exception id. Several records behind one exception: the latest of them. */
export async function exceptionDates(tenantId: string, rows: readonly Row[]): Promise<Map<string, string>> {
  const wanted = (...types: string[]) => [...new Set(rows.filter((r) => r.transactionType !== null && types.includes(r.transactionType)).flatMap(ids))];
  // A duplicate-invoice exception can name a bill and an expense together, whichever came first, so both tables are asked about all of its ids.
  const duplicates = wanted("purchase_bill", "expense");
  const [bills, expenseRows, entries, lines] = await Promise.all([
    duplicates.length ? db.select({ id: purchaseBills.id, d: purchaseBills.billDate }).from(purchaseBills).where(and(eq(purchaseBills.tenantId, tenantId), inArray(purchaseBills.id, duplicates))) : [],
    duplicates.length ? db.select({ id: expenses.id, d: expenses.expenseDate }).from(expenses).where(and(eq(expenses.tenantId, tenantId), inArray(expenses.id, duplicates))) : [],
    wanted("journal_entry").length ? db.select({ id: journalEntries.id, d: journalEntries.entryDate }).from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), inArray(journalEntries.id, wanted("journal_entry")))) : [],
    wanted("bank_statement_line").length ? db.select({ id: bankStatementLines.id, d: bankStatementLines.transactionDate }).from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), inArray(bankStatementLines.id, wanted("bank_statement_line")))) : [],
  ]);
  const dateOf = new Map<string, string>();
  for (const r of [...bills, ...expenseRows, ...entries, ...lines]) dateOf.set(r.id, r.d);

  const out = new Map<string, string>();
  for (const row of rows) {
    const own = ids(row).map((id) => dateOf.get(id)).filter((d): d is string => Boolean(d));
    out.set(row.id, own.length > 0 ? own.reduce((a, b) => (a > b ? a : b)) : row.detectedDate.toISOString().slice(0, 10));
  }
  return out;
}
