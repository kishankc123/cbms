import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankReconciliationMatchJournalLines, bankReconciliations, cashReconciliationLines, cashReconciliations, journalEntries, journalLines } from "@/db/schema";

/**
 * A bank account that has been reconciled up to a date is closed up to that date: nothing may be posted to its
 * ledger account inside the reconciled period until the reconciliation is reopened (Bank Reconciliation).
 */
export async function assertBankPeriodOpen(tenantId: string, date: string, accountIds: string[]) {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return;
  // The cash check runs alongside the bank one, so a posting waits for one round trip, not two.
  const cashCheck = assertCashPeriodOpen(tenantId, date, ids);
  cashCheck.catch(() => {});
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
  await cashCheck;
}

/**
 * A cash account that has been reconciled up to a date is closed before that date: nothing is posted to it on an earlier day until an administrator unlocks it
 * (Bank Reconciliation > the cash account > Reopen back to here). The reconciled day itself stays open, so a sale entered after the count is still accepted
 * and simply waits for the next reconciliation.
 */
export async function assertCashPeriodOpen(tenantId: string, date: string, accountIds: string[]) {
  const [closed] = await db
    .select({ name: accounts.name, through: sql<string>`max(${cashReconciliations.throughDate})` })
    .from(cashReconciliations)
    .innerJoin(accounts, eq(accounts.id, cashReconciliations.accountId))
    .where(and(eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.status, "reconciled"), inArray(cashReconciliations.accountId, accountIds)))
    .groupBy(accounts.name)
    .having(sql`max(${cashReconciliations.throughDate}) > ${date}`)
    .limit(1);
  if (closed) throw new Error(`${closed.name} has been reconciled up to ${closed.through}, so nothing can be posted to it on an earlier date. An administrator can unlock it: Bank Reconciliation, ${closed.name}, Reopen back to here.`);
}

/** Refuses to change or void entries whose cash line has been ticked in a cash reconciliation: they are locked until an administrator reopens it. */
export async function assertEntriesNotCashReconciled(tenantId: string, entryIds: string[]) {
  if (entryIds.length === 0) return;
  const [hit] = await db
    .select({ through: cashReconciliations.throughDate, name: accounts.name })
    .from(cashReconciliationLines)
    .innerJoin(cashReconciliations, eq(cashReconciliations.id, cashReconciliationLines.reconId))
    .innerJoin(journalLines, eq(journalLines.id, cashReconciliationLines.journalLineId))
    .innerJoin(accounts, eq(accounts.id, cashReconciliations.accountId))
    .where(and(eq(cashReconciliationLines.tenantId, tenantId), eq(cashReconciliations.status, "reconciled"), inArray(journalLines.journalEntryId, entryIds)))
    .limit(1);
  if (hit) throw new Error(`This entry was reconciled in ${hit.name} up to ${hit.through}, so it is locked: its amount, date and account can't change and it can't be voided. Its description and invoice details can still be edited. An administrator can unlock it: Bank Reconciliation, ${hit.name}, Reopen back to here.`);
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
