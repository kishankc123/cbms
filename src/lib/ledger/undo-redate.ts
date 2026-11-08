import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, journalEntries, journalLines } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { resolveFiscalYearId } from "@/lib/fiscal";
import { isDateOpenForPosting } from "./post";

// Puts back the dates changed by redate-reversals.ts, from the audit log it wrote (each record holds the entry, the date it had and the date it was moved
// to). An entry is restored only if it still has the date the re-dating gave it (so nothing changed since is overwritten) and both months are still open.

export type UndoItem = { entryId: string; tenantId: string; from: string; to: string; reference: string | null };
export type UndoSkip = UndoItem & { reason: string };
export type UndoReport = { restored: UndoItem[]; skipped: UndoSkip[] };

export async function undoRedatedReversals(opts: { tenantId?: string; apply: boolean; userId?: string | null }): Promise<UndoReport> {
  const records = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "reversal_redated"), eq(auditLog.entityType, "journal_entry"), opts.tenantId ? eq(auditLog.tenantId, opts.tenantId) : undefined))
    .orderBy(desc(auditLog.timestamp));

  const report: UndoReport = { restored: [], skipped: [] };
  const handled = new Set<string>(); // the newest record for an entry decides; older ones for the same entry are history
  for (const rec of records) {
    if (!rec.entityId || !rec.tenantId || handled.has(rec.entityId)) continue;
    handled.add(rec.entityId);
    const was = (rec.beforeValue as { entryDate?: string } | null)?.entryDate;
    const moved = (rec.afterValue as { entryDate?: string } | null)?.entryDate;
    if (!was || !moved) continue;

    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, rec.entityId), eq(journalEntries.tenantId, rec.tenantId))).limit(1);
    if (!entry) continue;
    const item: UndoItem = { entryId: entry.id, tenantId: entry.tenantId, from: entry.entryDate, to: was, reference: entry.referenceNumber };
    if (entry.entryDate !== moved) {
      report.skipped.push({ ...item, reason: entry.entryDate === was ? "Already has its earlier date." : `It has a different date now (${entry.entryDate}), changed since the re-dating.` });
      continue;
    }
    const lines = await db.select({ accountId: journalLines.accountId }).from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
    const accountIds = lines.map((l) => l.accountId);
    if (!(await isDateOpenForPosting(entry.tenantId, moved, accountIds)) || !(await isDateOpenForPosting(entry.tenantId, was, accountIds))) {
      report.skipped.push({ ...item, reason: "A month involved is closed or reconciled now." });
      continue;
    }
    if (opts.apply) {
      const fiscalYearId = await resolveFiscalYearId(entry.tenantId, was);
      await db.update(journalEntries).set({ entryDate: was, fiscalYearId }).where(and(eq(journalEntries.id, entry.id), eq(journalEntries.tenantId, entry.tenantId)));
      await logAuditEvent({ tenantId: entry.tenantId, userId: opts.userId ?? null, action: "reversal_redate_undone", entityType: "journal_entry", entityId: entry.id, before: { entryDate: moved }, after: { entryDate: was } });
    }
    report.restored.push(item);
  }
  return report;
}
