import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bankReconciliationMatchJournalLines, cashReconciliationLines, cashReconciliations, journalLines } from "@/db/schema";

/**
 * Which of these journal entries have been reconciled: matched to a bank statement line (Bank Reconciliation), or ticked in a cash reconciliation of
 * a cash account. For the Reconciliation column of Payments.
 */
export async function reconciledEntryIds(tenantId: string, journalEntryIds: string[]): Promise<Set<string>> {
  if (journalEntryIds.length === 0) return new Set();
  const [bank, cash] = await Promise.all([
    db
      .select({ journalEntryId: journalLines.journalEntryId })
      .from(bankReconciliationMatchJournalLines)
      .innerJoin(journalLines, eq(journalLines.id, bankReconciliationMatchJournalLines.journalLineId))
      .where(inArray(journalLines.journalEntryId, journalEntryIds)),
    db
      .select({ journalEntryId: journalLines.journalEntryId })
      .from(cashReconciliationLines)
      .innerJoin(cashReconciliations, eq(cashReconciliations.id, cashReconciliationLines.reconId))
      .innerJoin(journalLines, eq(journalLines.id, cashReconciliationLines.journalLineId))
      .where(and(eq(cashReconciliationLines.tenantId, tenantId), eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.status, "reconciled"), inArray(journalLines.journalEntryId, journalEntryIds))),
  ]);
  return new Set([...bank, ...cash].map((r) => r.journalEntryId));
}
