import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { bankReconciliationMatchJournalLines, journalEntries, journalLines } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { resolveFiscalYearId } from "@/lib/fiscal";
import { isDateOpenForPosting } from "./post";

// Before, the undo of an entry (an edited or voided invoice, bill or payment) was always dated the day it was made. Editing an invoice from an earlier
// month therefore left the old sale in its own month and took the same amount off the current month, sometimes below zero. The undo now takes the
// entry's own date. This brings the entries posted the old way in line: each undo is moved to the date of the entry it undoes.
//
// An entry is moved only when it is safe: both the month it sits in now and the month it moves to are open (month, fiscal year, bank reconciliation),
// and none of its lines has been matched to a bank statement. Everything else is left exactly as it is and listed with the reason.

export type RedateItem = { entryId: string; tenantId: string; from: string; to: string; reference: string | null; memo: string | null };
export type RedateSkip = RedateItem & { reason: string };
export type RedateReport = { moved: RedateItem[]; skipped: RedateSkip[] };

export async function redateReversals(opts: { tenantId?: string; apply: boolean; userId?: string | null }): Promise<RedateReport> {
  const original = alias(journalEntries, "original");
  const rows = await db
    .select({ id: journalEntries.id, tenantId: journalEntries.tenantId, from: journalEntries.entryDate, to: original.entryDate, reference: journalEntries.referenceNumber, memo: journalEntries.memo })
    .from(journalEntries)
    .innerJoin(original, eq(original.id, journalEntries.reversalOfId))
    .where(and(opts.tenantId ? eq(journalEntries.tenantId, opts.tenantId) : undefined, sql`${journalEntries.entryDate} > ${original.entryDate}`))
    .orderBy(asc(journalEntries.tenantId), asc(journalEntries.entryDate));

  const report: RedateReport = { moved: [], skipped: [] };
  for (const r of rows) {
    const item: RedateItem = { entryId: r.id, tenantId: r.tenantId, from: r.from, to: r.to, reference: r.reference, memo: r.memo };
    const lines = await db.select({ id: journalLines.id, accountId: journalLines.accountId }).from(journalLines).where(eq(journalLines.journalEntryId, r.id));
    const accountIds = lines.map((l) => l.accountId);

    const [matched] = lines.length
      ? await db.select({ id: bankReconciliationMatchJournalLines.id }).from(bankReconciliationMatchJournalLines).where(inArray(bankReconciliationMatchJournalLines.journalLineId, lines.map((l) => l.id))).limit(1)
      : [];
    if (matched) {
      report.skipped.push({ ...item, reason: "A line of this entry is matched to a bank statement." });
      continue;
    }
    // Moving an entry out of a closed month would change that month's closed figures; moving it into one would change a closed month too.
    if (!(await isDateOpenForPosting(r.tenantId, r.from, accountIds))) {
      report.skipped.push({ ...item, reason: `The month it is in now (${r.from}) is closed or reconciled.` });
      continue;
    }
    if (!(await isDateOpenForPosting(r.tenantId, r.to, accountIds))) {
      report.skipped.push({ ...item, reason: `The month it would move to (${r.to}) is closed or reconciled.` });
      continue;
    }
    if (opts.apply) {
      const fiscalYearId = await resolveFiscalYearId(r.tenantId, r.to);
      await db.update(journalEntries).set({ entryDate: r.to, fiscalYearId }).where(and(eq(journalEntries.id, r.id), eq(journalEntries.tenantId, r.tenantId), ne(journalEntries.entryDate, r.to)));
      await logAuditEvent({ tenantId: r.tenantId, userId: opts.userId ?? null, action: "reversal_redated", entityType: "journal_entry", entityId: r.id, before: { entryDate: r.from }, after: { entryDate: r.to, reason: "Undo entry moved to the date of the entry it undoes" } });
    }
    report.moved.push(item);
  }
  return report;
}
