import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  bankStatementLines,
  bankReconciliationMatches,
  bankReconciliationMatchJournalLines,
  unmatchedLedgerClassifications,
  journalEntries,
  journalLines,
} from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReconciliationAssessment = {
  statementBalance: number;
  ledgerBalance: number;
  /** statement balance minus ledger balance */
  difference: number;
  unmatchedBank: { id: string; date: string; description: string | null; amount: number }[];
  unmatchedLedger: { journalLineId: string; date: string; memo: string | null; amount: number; classification: string | null }[];
  /** Reasons the period can't be marked reconciled yet. Empty = ready. */
  blockers: string[];
};

/**
 * Where a bank account stands as of `periodEnd`: the statement balance (opening balance + every statement line up to
 * then), the ledger balance (every posting to the bank's ledger account up to then), and what is not yet matched.
 * A period can be marked reconciled only when every bank line is matched and every unmatched ledger transaction has
 * been explained (outstanding cheque, deposit in transit...), and the two balances then agree once those are counted.
 */
export async function assessReconciliation(
  tenantId: string,
  bank: { id: string; chartOfAccountsLink: string; openingBalance: string },
  periodEnd: string
): Promise<ReconciliationAssessment> {
  const statement = await db
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.bankAccountId, bank.id), lte(bankStatementLines.transactionDate, periodEnd)));

  const ledger = await db
    .select({
      id: journalLines.id,
      date: journalEntries.entryDate,
      memo: journalEntries.memo,
      debit: journalLines.debitAmount,
      credit: journalLines.creditAmount,
      reversed: journalEntries.isReversed,
      isReversal: journalEntries.reversalOfId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, bank.chartOfAccountsLink), lte(journalEntries.entryDate, periodEnd)));

  const matched = new Set(
    (
      await db
        .select({ id: bankReconciliationMatchJournalLines.journalLineId })
        .from(bankReconciliationMatchJournalLines)
        .innerJoin(bankReconciliationMatches, eq(bankReconciliationMatches.id, bankReconciliationMatchJournalLines.matchId))
        .where(and(eq(bankReconciliationMatches.tenantId, tenantId), isNull(bankReconciliationMatches.unmatchedAt)))
    ).map((r) => r.id)
  );
  const classes = new Map(
    (
      await db
        .select()
        .from(unmatchedLedgerClassifications)
        .where(and(eq(unmatchedLedgerClassifications.tenantId, tenantId), eq(unmatchedLedgerClassifications.bankAccountId, bank.id)))
    ).map((c) => [c.journalLineId, c.classification as string])
  );

  const statementBalance = round2(Number(bank.openingBalance) + statement.reduce((s, l) => s + Number(l.amount), 0));
  // A reversed entry and its reversal cancel, so the balance counts everything; only live lines can be "unmatched".
  const ledgerBalance = round2(ledger.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));

  const unmatchedBank = statement
    .filter((l) => l.matchStatus !== "matched" && l.matchStatus !== "ignored")
    .map((l) => ({ id: l.id, date: l.transactionDate, description: l.description, amount: Number(l.amount) }));
  const unmatchedLedger = ledger
    .filter((l) => !l.reversed && !l.isReversal && !matched.has(l.id))
    .map((l) => ({ journalLineId: l.id, date: l.date, memo: l.memo, amount: round2(Number(l.debit) - Number(l.credit)), classification: classes.get(l.id) ?? null }));

  const bankUnmatchedSum = round2(unmatchedBank.reduce((s, l) => s + l.amount, 0));
  const ledgerUnmatchedSum = round2(unmatchedLedger.reduce((s, l) => s + l.amount, 0));
  const difference = round2(statementBalance - ledgerBalance);

  const blockers: string[] = [];
  if (statement.length === 0) blockers.push("There are no bank statement lines up to that date — import the statement first.");
  if (unmatchedBank.length > 0) blockers.push(`${unmatchedBank.length} bank statement line(s) aren't matched yet.`);
  const unexplained = unmatchedLedger.filter((l) => !l.classification || l.classification === "incorrect_transaction");
  if (unexplained.length > 0) {
    blockers.push(`${unexplained.length} ledger transaction(s) aren't on the statement and haven't been explained — match them, or classify them (outstanding cheque, deposit in transit...).`);
  }
  // Everything matched agreed by amount, so the two balances differ only by the unmatched items.
  if (Math.abs(difference - (bankUnmatchedSum - ledgerUnmatchedSum)) > 0.05) {
    blockers.push(
      `The balances don't reconcile: statement ${statementBalance.toFixed(2)} vs ledger ${ledgerBalance.toFixed(2)}, and the unmatched items only account for ${(bankUnmatchedSum - ledgerUnmatchedSum).toFixed(2)} of the ${difference.toFixed(2)} difference. Check the bank account's opening balance and the matches.`
    );
  }

  return { statementBalance, ledgerBalance, difference, unmatchedBank, unmatchedLedger, blockers };
}
