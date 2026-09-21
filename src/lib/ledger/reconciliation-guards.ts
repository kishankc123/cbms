import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts, bankReconciliationMatchJournalLines, bankReconciliations, journalEntries, journalLines } from "@/db/schema";

/**
 * A bank account that has been reconciled up to a date is closed up to that date: nothing may be posted to its
 * ledger account inside the reconciled period until the reconciliation is reopened (Bank Reconciliation).
 */
export async function assertBankPeriodOpen(tenantId: string, date: string, accountIds: string[]) {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return;
  const [locked] = await db
    .select({ name: bankAccounts.accountName, start: bankReconciliations.periodStart, end: bankReconciliations.periodEnd })
    .from(bankAccounts)
    .innerJoin(bankReconciliations, eq(bankReconciliations.bankAccountId, bankAccounts.id))
    .where(
      and(
        eq(bankAccounts.tenantId, tenantId),
        inArray(bankAccounts.chartOfAccountsLink, ids),
        eq(bankReconciliations.status, "reconciled"),
        lte(bankReconciliations.periodStart, date),
        gte(bankReconciliations.periodEnd, date)
      )
    )
    .limit(1);
  if (locked) throw new Error(`${locked.name} has been reconciled for ${locked.start} to ${locked.end} — reopen that reconciliation in Bank Reconciliation before posting here`);
}

/** Refuses to change a document whose entries include a bank line that has been matched to a bank statement. */
export async function assertSourceNotReconciled(tenantId: string, sourceId: string, what: string) {
  const [matched] = await db
    .select({ id: bankReconciliationMatchJournalLines.id })
    .from(bankReconciliationMatchJournalLines)
    .innerJoin(journalLines, eq(journalLines.id, bankReconciliationMatchJournalLines.journalLineId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, sourceId)))
    .limit(1);
  if (matched) throw new Error(`A bank line of this ${what} has been matched to a bank statement — unmatch it in Bank Reconciliation first`);
}

/** Same, for one journal entry. */
export async function assertEntryNotReconciled(tenantId: string, entryId: string, what = "entry") {
  const [matched] = await db
    .select({ id: bankReconciliationMatchJournalLines.id })
    .from(bankReconciliationMatchJournalLines)
    .innerJoin(journalLines, eq(journalLines.id, bankReconciliationMatchJournalLines.journalLineId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.id, entryId)))
    .limit(1);
  if (matched) throw new Error(`A bank line of this ${what} has been matched to a bank statement — unmatch it in Bank Reconciliation first`);
}
