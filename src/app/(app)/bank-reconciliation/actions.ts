"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, inArray, asc, desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  bankStatementTemplates,
  bankStatementImports,
  bankStatementLines,
  bankReconciliationMatches,
  bankReconciliationMatchLines,
  bankReconciliationMatchJournalLines,
  unmatchedLedgerClassifications,
  bankReconciliations,
  journalEntries,
  journalLines,
  accounts,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { postJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { parseStatementFile } from "@/lib/banking/parse-statement";
import { normalizeStatementRows, type ColumnMapping, type DateImportOptions } from "@/lib/banking/normalize-rows";
import type { ImportDateResult } from "@/lib/banking/import-dates";
import { findMatchCandidates, type MatchCandidate } from "@/lib/banking/matching";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Bank account setup ----------

export async function getOffsetAccountOptions() {
  const session = await requireTenantSession();
  return db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, category: accounts.category })
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true)))
    .orderBy(accounts.code);
}

export async function getBankAccountLedgerOptions() {
  const session = await requireTenantSession();
  const linked = await db.select({ id: bankAccounts.chartOfAccountsLink }).from(bankAccounts).where(eq(bankAccounts.tenantId, session.tenantId));
  const linkedIds = new Set(linked.map((r) => r.id));

  const rows = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true), eq(accounts.category, "asset")))
    .orderBy(accounts.code);

  return rows.filter((a) => !linkedIds.has(a.id));
}

export async function listBankAccounts() {
  const session = await requireTenantSession();
  return db
    .select({
      id: bankAccounts.id,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      branch: bankAccounts.branch,
      currency: bankAccounts.currency,
      chartOfAccountsLink: bankAccounts.chartOfAccountsLink,
      openingBalance: bankAccounts.openingBalance,
      isActive: bankAccounts.isActive,
      ledgerCode: accounts.code,
      ledgerName: accounts.name,
    })
    .from(bankAccounts)
    .innerJoin(accounts, eq(accounts.id, bankAccounts.chartOfAccountsLink))
    .where(eq(bankAccounts.tenantId, session.tenantId))
    .orderBy(asc(bankAccounts.accountName));
}

export type BankAccountInput = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  currency: string;
  chartOfAccountsLink: string;
  openingBalance: number;
};

export async function createBankAccount(input: BankAccountInput) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");
  if (!input.accountName.trim()) throw new Error("Account name is required");
  if (!input.chartOfAccountsLink) throw new Error("Select a ledger account");

  await db.insert(bankAccounts).values({
    tenantId: session.tenantId,
    bankName: input.bankName.trim() || null,
    accountName: input.accountName.trim(),
    accountNumber: input.accountNumber.trim() || null,
    branch: input.branch.trim() || null,
    currency: input.currency.trim() || "NPR",
    chartOfAccountsLink: input.chartOfAccountsLink,
    openingBalance: round2(input.openingBalance).toFixed(2),
  });

  revalidatePath("/bank-reconciliation");
  revalidatePath("/bank-reconciliation/setup");
}

export async function updateBankAccount(input: BankAccountInput & { bankAccountId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  if (!input.accountName.trim()) throw new Error("Account name is required");

  await db
    .update(bankAccounts)
    .set({
      bankName: input.bankName.trim() || null,
      accountName: input.accountName.trim(),
      accountNumber: input.accountNumber.trim() || null,
      branch: input.branch.trim() || null,
      currency: input.currency.trim() || "NPR",
      openingBalance: round2(input.openingBalance).toFixed(2),
    })
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)));

  revalidatePath("/bank-reconciliation");
  revalidatePath("/bank-reconciliation/setup");
}

// Deactivating a bank account also deactivates its linked Chart of Accounts
// row, so it disappears from every RECORD PAY picker app-wide — an inactive
// bank account must not be usable for new transactions anywhere.
export async function setBankAccountActive(input: { bankAccountId: string; isActive: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");

  const [bankAccount] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bankAccount) throw new Error("Bank account not found");

  await db.update(bankAccounts).set({ isActive: input.isActive }).where(eq(bankAccounts.id, input.bankAccountId));
  await db.update(accounts).set({ isActive: input.isActive }).where(eq(accounts.id, bankAccount.chartOfAccountsLink));

  revalidatePath("/bank-reconciliation");
  revalidatePath("/bank-reconciliation/setup");
  revalidatePath("/chart-of-accounts");
}

// ---------- Statement upload ----------

export type StatementPreview = {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestedMapping: ColumnMapping | null;
};

const MAPPING_FIELDS = ["date", "description", "debit", "credit", "amount", "reference", "balance"] as const;

export async function previewStatementFile(input: { bankAccountId: string; fileName: string; base64: string }): Promise<StatementPreview> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");

  const { headers, rows } = parseStatementFile(input.base64, input.fileName);
  if (headers.length === 0) throw new Error("Could not read any columns from this file");

  const [bankAccount] = await db
    .select({ bankName: bankAccounts.bankName })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);

  let suggestedMapping: ColumnMapping | null = null;
  if (bankAccount?.bankName) {
    const [template] = await db
      .select()
      .from(bankStatementTemplates)
      .where(and(eq(bankStatementTemplates.tenantId, session.tenantId), eq(bankStatementTemplates.bankAccountId, input.bankAccountId)))
      .orderBy(desc(bankStatementTemplates.createdAt))
      .limit(1);
    if (template) suggestedMapping = template.columnMapping as ColumnMapping;
  }

  return { headers, sampleRows: rows.slice(0, 10), totalRows: rows.length, suggestedMapping };
}

export type DatePreview = ImportDateResult & {
  /** Only the rows worth showing: the first few, plus every problem row. */
  shown: ImportDateResult["rows"];
  totalRows: number;
};

// Shows how the file's date column will be read (AD or BS, auto-detected or
// chosen by the user) and what each date converts to — before anything is imported.
export async function previewStatementDates(input: {
  bankAccountId: string;
  fileName: string;
  base64: string;
  dateColumn: string;
  choice: DateImportOptions["choice"];
  dayFirst: boolean;
  allowMixed: boolean;
}): Promise<DatePreview> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");
  const { headers, rows } = parseStatementFile(input.base64, input.fileName);
  const { dates } = normalizeStatementRows(headers, rows, { date: input.dateColumn }, { choice: input.choice, dayFirst: input.dayFirst, allowMixed: input.allowMixed });
  const shown = dates.rows.filter((r, i) => i < 12 || r.status === "invalid" || r.status === "ambiguous" || r.dayMonthAmbiguous || r.projected || (dates.mixed && i < 200)).slice(0, 200);
  return { ...dates, rows: [], shown, totalRows: dates.rows.length };
}

export type ConfirmImportInput = {
  bankAccountId: string;
  fileName: string;
  base64: string;
  mapping: ColumnMapping;
  statementPeriodStart: string;
  statementPeriodEnd: string;
  saveAsTemplateName: string;
  /** How to read the date column; the stored result is always AD. */
  dateChoice?: DateImportOptions["choice"];
  dayFirst?: boolean;
  allowMixedDates?: boolean;
};

export type ConfirmImportResult = { imported: number; duplicates: number; skipped: number };

export async function confirmStatementImport(input: ConfirmImportInput): Promise<ConfirmImportResult> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");
  if (!input.mapping.date) throw new Error("Map at least the Date column");
  if (!input.mapping.debit && !input.mapping.credit && !input.mapping.amount) {
    throw new Error("Map at least an Amount column, or both Debit and Credit");
  }

  const { headers, rows } = parseStatementFile(input.base64, input.fileName);
  const { valid, skipped, dates } = normalizeStatementRows(headers, rows, input.mapping, {
    choice: input.dateChoice ?? "auto",
    dayFirst: input.dayFirst ?? true,
    allowMixed: input.allowMixedDates ?? false,
  });
  if (dates.blocking) {
    throw new Error("The dates in this file need to be reviewed first — choose AD or BS, or fix the highlighted rows.");
  }
  if (valid.length === 0) throw new Error("No valid transaction rows found with this column mapping");

  const existingHashes = await db
    .select({ hash: bankStatementLines.dedupeHash })
    .from(bankStatementLines)
    .where(eq(bankStatementLines.bankAccountId, input.bankAccountId));
  const existingSet = new Set(existingHashes.map((r) => r.hash));

  const newRows = valid.filter((r) => !existingSet.has(r.dedupeHash));
  const duplicates = valid.length - newRows.length;
  if (newRows.length === 0) throw new Error("Every row in this file has already been imported for this bank account");

  const [importRow] = await db
    .insert(bankStatementImports)
    .values({
      tenantId: session.tenantId,
      bankAccountId: input.bankAccountId,
      fileName: input.fileName,
      statementPeriodStart: input.statementPeriodStart,
      statementPeriodEnd: input.statementPeriodEnd,
      rowCount: newRows.length,
      status: "confirmed",
    })
    .returning();

  await db.insert(bankStatementLines).values(
    newRows.map((r) => ({
      tenantId: session.tenantId,
      bankAccountId: input.bankAccountId,
      importId: importRow.id,
      transactionDate: r.transactionDate,
      description: r.description || null,
      reference: r.reference || null,
      amount: r.amount.toFixed(2),
      runningBalance: r.runningBalance !== null ? r.runningBalance.toFixed(2) : null,
      dedupeHash: r.dedupeHash,
    }))
  );

  if (input.saveAsTemplateName.trim()) {
    await db.insert(bankStatementTemplates).values({
      tenantId: session.tenantId,
      bankAccountId: input.bankAccountId,
      name: input.saveAsTemplateName.trim(),
      columnMapping: input.mapping,
    });
  }

  revalidatePath("/bank-reconciliation");
  return { imported: newRows.length, duplicates, skipped };
}

// ---------- Reconciliation workspace ----------

export type StatementLineRow = {
  id: string;
  transactionDate: string;
  description: string | null;
  reference: string | null;
  amount: number;
  matchStatus: string;
  matchId: string | null;
};

export type UnmatchedLedgerRow = {
  journalLineId: string;
  journalEntryId: string;
  entryDate: string;
  memo: string | null;
  referenceNumber: string | null;
  description: string | null;
  signedAmount: number;
  classification: string | null;
};

export async function getReconciliationWorkspace(bankAccountId: string) {
  const session = await requireTenantSession();

  const [bankAccount] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bankAccount) throw new Error("Bank account not found");

  const statementLines = await db
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.tenantId, session.tenantId), eq(bankStatementLines.bankAccountId, bankAccountId)))
    .orderBy(desc(bankStatementLines.transactionDate));

  const matchedJournalLineIds = await db.select({ id: bankReconciliationMatchJournalLines.journalLineId }).from(bankReconciliationMatchJournalLines);
  const matchedSet = new Set(matchedJournalLineIds.map((r) => r.id));

  // Excludes both a voided/edited-away entry (isReversed) and its own
  // reversal entry (reversalOfId set) — a corrected-away transaction has
  // nothing left to reconcile, on either side of the correction.
  const ledgerRows = await db
    .select({
      journalLineId: journalLines.id,
      journalEntryId: journalEntries.id,
      entryDate: journalEntries.entryDate,
      memo: journalEntries.memo,
      referenceNumber: journalEntries.referenceNumber,
      description: journalLines.description,
      debitAmount: journalLines.debitAmount,
      creditAmount: journalLines.creditAmount,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(
      and(
        eq(journalEntries.tenantId, session.tenantId),
        eq(journalLines.accountId, bankAccount.chartOfAccountsLink),
        eq(journalEntries.isReversed, false),
        isNull(journalEntries.reversalOfId)
      )
    )
    .orderBy(desc(journalEntries.entryDate));

  // The account's actual balance sums every posting including reversed
  // entries and their reversals — those cancel out by construction, so
  // filtering by isReversed here (asymmetrically excluding an original
  // while keeping its reversal) would leave a phantom balance behind.
  const allLines = await db
    .select({ debitAmount: journalLines.debitAmount, creditAmount: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, session.tenantId), eq(journalLines.accountId, bankAccount.chartOfAccountsLink)));

  const classifications = await db
    .select()
    .from(unmatchedLedgerClassifications)
    .where(and(eq(unmatchedLedgerClassifications.tenantId, session.tenantId), eq(unmatchedLedgerClassifications.bankAccountId, bankAccountId)));
  const classificationByLine = new Map(classifications.map((c) => [c.journalLineId, c.classification]));

  const unmatchedLedger: UnmatchedLedgerRow[] = ledgerRows
    .filter((r) => !matchedSet.has(r.journalLineId))
    .map((r) => ({
      journalLineId: r.journalLineId,
      journalEntryId: r.journalEntryId,
      entryDate: r.entryDate,
      memo: r.memo,
      referenceNumber: r.referenceNumber,
      description: r.description,
      signedAmount: round2(Number(r.debitAmount) - Number(r.creditAmount)),
      classification: classificationByLine.get(r.journalLineId) ?? null,
    }));

  const matchLinesForStatement = await db
    .select({ statementLineId: bankReconciliationMatchLines.statementLineId, matchId: bankReconciliationMatchLines.matchId })
    .from(bankReconciliationMatchLines)
    .where(
      inArray(
        bankReconciliationMatchLines.statementLineId,
        statementLines.length > 0 ? statementLines.map((l) => l.id) : ["00000000-0000-0000-0000-000000000000"]
      )
    );
  const matchIdByStatementLine = new Map(matchLinesForStatement.map((r) => [r.statementLineId, r.matchId]));

  const statementRows: StatementLineRow[] = statementLines.map((l) => ({
    id: l.id,
    transactionDate: l.transactionDate,
    description: l.description,
    reference: l.reference,
    amount: Number(l.amount),
    matchStatus: l.matchStatus,
    matchId: matchIdByStatementLine.get(l.id) ?? null,
  }));

  const ledgerBalance = round2(
    Number(bankAccount.openingBalance) + allLines.reduce((s, r) => s + Number(r.debitAmount) - Number(r.creditAmount), 0)
  );
  const statementBalance = round2(Number(bankAccount.openingBalance) + statementLines.reduce((s, l) => s + Number(l.amount), 0));
  const matchedAmount = round2(statementLines.filter((l) => l.matchStatus === "matched").reduce((s, l) => s + Number(l.amount), 0));
  const unmatchedBankAmount = round2(statementLines.filter((l) => l.matchStatus !== "matched").reduce((s, l) => s + Number(l.amount), 0));

  const activeReconciliation = await db
    .select()
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.tenantId, session.tenantId), eq(bankReconciliations.bankAccountId, bankAccountId)))
    .orderBy(desc(bankReconciliations.createdAt))
    .limit(1);

  return {
    bankAccount: {
      id: bankAccount.id,
      bankName: bankAccount.bankName,
      accountName: bankAccount.accountName,
      accountNumber: bankAccount.accountNumber,
      chartOfAccountsLink: bankAccount.chartOfAccountsLink,
    },
    statementLines: statementRows,
    unmatchedLedger,
    statementBalance,
    ledgerBalance,
    matchedAmount,
    unmatchedBankAmount,
    difference: round2(statementBalance - ledgerBalance),
    latestReconciliation: activeReconciliation[0] ?? null,
  };
}

// Computes the top match candidate for every unmatched statement line on a
// bank account in one call, so the Suggested Matches tab doesn't need one
// round-trip per row.
export async function getSuggestedMatchesForAccount(bankAccountId: string): Promise<Record<string, MatchCandidate>> {
  const session = await requireTenantSession();
  const [bankAccount] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bankAccount) throw new Error("Bank account not found");

  const unmatchedLines = await db
    .select()
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.tenantId, session.tenantId),
        eq(bankStatementLines.bankAccountId, bankAccountId),
        eq(bankStatementLines.matchStatus, "unmatched")
      )
    );

  const result: Record<string, MatchCandidate> = {};
  for (const line of unmatchedLines) {
    const candidates = await findMatchCandidates(session.tenantId, bankAccount.chartOfAccountsLink, {
      transactionDate: line.transactionDate,
      amount: Number(line.amount),
      description: line.description ?? "",
      reference: line.reference ?? "",
    });
    if (candidates.length > 0) result[line.id] = candidates[0];
  }
  return result;
}

export async function getSuggestedMatchesForLine(statementLineId: string): Promise<MatchCandidate[]> {
  const session = await requireTenantSession();
  const [line] = await db
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, statementLineId), eq(bankStatementLines.tenantId, session.tenantId)))
    .limit(1);
  if (!line) throw new Error("Statement line not found");

  const [bankAccount] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, line.bankAccountId)).limit(1);
  if (!bankAccount) throw new Error("Bank account not found");

  return findMatchCandidates(session.tenantId, bankAccount.chartOfAccountsLink, {
    transactionDate: line.transactionDate,
    amount: Number(line.amount),
    description: line.description ?? "",
    reference: line.reference ?? "",
  });
}

// Confirms a match between one-or-more statement lines and one-or-more
// journal lines — supports 1:1, 1:many, many:1, and many:many, as long as
// the two sides' totals agree. Every match (even a 100%-confidence
// suggestion) requires this explicit confirmation; nothing auto-reconciles.
export async function confirmMatch(input: {
  bankAccountId: string;
  statementLineIds: string[];
  journalLineIds: string[];
  matchType: "exact" | "suggested" | "manual";
  confidence?: number;
}) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  if (input.statementLineIds.length === 0 || input.journalLineIds.length === 0) {
    throw new Error("Select at least one bank line and one ledger line");
  }

  const statementLinesToMatch = await db
    .select()
    .from(bankStatementLines)
    .where(and(inArray(bankStatementLines.id, input.statementLineIds), eq(bankStatementLines.tenantId, session.tenantId)));
  const journalLinesToMatch = await db.select().from(journalLines).where(inArray(journalLines.id, input.journalLineIds));

  const statementTotal = round2(statementLinesToMatch.reduce((s, l) => s + Number(l.amount), 0));
  const journalTotal = round2(journalLinesToMatch.reduce((s, l) => s + (Number(l.debitAmount) - Number(l.creditAmount)), 0));
  if (Math.abs(statementTotal - journalTotal) > 0.01) {
    throw new Error(`Selected amounts don't agree (bank ${statementTotal.toFixed(2)} vs ledger ${journalTotal.toFixed(2)})`);
  }

  const [match] = await db
    .insert(bankReconciliationMatches)
    .values({
      tenantId: session.tenantId,
      bankAccountId: input.bankAccountId,
      matchType: input.matchType,
      confidence: input.confidence !== undefined ? input.confidence.toFixed(2) : null,
      createdBy: session.userId,
    })
    .returning();

  await db.insert(bankReconciliationMatchLines).values(
    statementLinesToMatch.map((l) => ({ matchId: match.id, statementLineId: l.id, amountApplied: l.amount }))
  );
  await db.insert(bankReconciliationMatchJournalLines).values(
    journalLinesToMatch.map((l) => ({
      matchId: match.id,
      journalLineId: l.id,
      amountApplied: (Number(l.debitAmount) - Number(l.creditAmount)).toFixed(2),
    }))
  );

  await db
    .update(bankStatementLines)
    .set({ matchStatus: "matched" })
    .where(inArray(bankStatementLines.id, input.statementLineIds));

  revalidatePath("/bank-reconciliation");
}

export async function unmatch(matchId: string) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");

  const [match] = await db
    .select()
    .from(bankReconciliationMatches)
    .where(and(eq(bankReconciliationMatches.id, matchId), eq(bankReconciliationMatches.tenantId, session.tenantId)))
    .limit(1);
  if (!match) throw new Error("Match not found");

  const matchLines = await db.select().from(bankReconciliationMatchLines).where(eq(bankReconciliationMatchLines.matchId, matchId));
  const statementLineIds = matchLines.map((l) => l.statementLineId);

  const linesInfo = await db.select().from(bankStatementLines).where(inArray(bankStatementLines.id, statementLineIds));
  for (const line of linesInfo) {
    if (await isPeriodLocked(match.bankAccountId, line.transactionDate)) {
      throw new Error("This match falls inside a reconciled period — reopen that reconciliation first");
    }
  }

  await db.update(bankReconciliationMatches).set({ unmatchedBy: session.userId, unmatchedAt: new Date() }).where(eq(bankReconciliationMatches.id, matchId));
  await db.update(bankStatementLines).set({ matchStatus: "unmatched" }).where(inArray(bankStatementLines.id, statementLineIds));
  await db.delete(bankReconciliationMatchLines).where(eq(bankReconciliationMatchLines.matchId, matchId));
  await db.delete(bankReconciliationMatchJournalLines).where(eq(bankReconciliationMatchJournalLines.matchId, matchId));

  revalidatePath("/bank-reconciliation");
}

async function isPeriodLocked(bankAccountId: string, date: string): Promise<boolean> {
  const [locked] = await db
    .select({ id: bankReconciliations.id })
    .from(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.bankAccountId, bankAccountId),
        eq(bankReconciliations.status, "reconciled"),
        lte(bankReconciliations.periodStart, date),
        gte(bankReconciliations.periodEnd, date)
      )
    )
    .limit(1);
  return Boolean(locked);
}

// ---------- Create transaction from an unmatched bank line ----------

export type CreateBankTransactionInput = {
  statementLineId: string;
  bankAccountId: string;
  type: "payment" | "receipt" | "bank_charge" | "transfer" | "other";
  description: string;
  offsetAccountId: string;
};

// A unified poster for the "money showed up in the bank but nothing's in
// the ledger yet" case — posts a plain two-line entry against the bank's
// ledger account and the chosen offset account, then immediately links it
// to the statement line that prompted it (a manual, 100%-confidence match).
export async function createBankTransaction(input: CreateBankTransactionInput) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");

  const [line] = await db
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, input.statementLineId), eq(bankStatementLines.tenantId, session.tenantId)))
    .limit(1);
  if (!line) throw new Error("Statement line not found");
  if (line.matchStatus === "matched") throw new Error("This line is already matched");

  const [bankAccount] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, input.bankAccountId)).limit(1);
  if (!bankAccount) throw new Error("Bank account not found");

  const amount = Math.abs(Number(line.amount));
  const moneyIn = Number(line.amount) > 0;
  const lines: PostLineInput[] = moneyIn
    ? [
        { accountId: bankAccount.chartOfAccountsLink, debitAmount: amount, description: input.description || undefined },
        { accountId: input.offsetAccountId, creditAmount: amount, description: input.description || undefined },
      ]
    : [
        { accountId: input.offsetAccountId, debitAmount: amount, description: input.description || undefined },
        { accountId: bankAccount.chartOfAccountsLink, creditAmount: amount, description: input.description || undefined },
      ];

  const entry = await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: line.transactionDate,
    sourceType: "bank_adjustment",
    referenceNumber: line.reference ?? undefined,
    memo: input.description || `${input.type.replace("_", " ")} from bank reconciliation`,
    createdBy: session.userId,
    lines,
  });

  const postedLines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
  const bankLine = postedLines.find((l) => l.accountId === bankAccount.chartOfAccountsLink);
  if (!bankLine) throw new Error("Failed to post the bank side of this transaction");

  await confirmMatch({
    bankAccountId: input.bankAccountId,
    statementLineIds: [input.statementLineId],
    journalLineIds: [bankLine.id],
    matchType: "manual",
  });

  revalidatePath("/bank-reconciliation");
}

// ---------- Classification ----------

export async function classifyUnmatchedLedgerLine(input: {
  journalLineId: string;
  bankAccountId: string;
  classification: "outstanding_cheque" | "pending_bank_transaction" | "not_yet_cleared" | "timing_difference" | "incorrect_transaction";
  notes: string;
}) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");

  await db.delete(unmatchedLedgerClassifications).where(
    and(eq(unmatchedLedgerClassifications.tenantId, session.tenantId), eq(unmatchedLedgerClassifications.journalLineId, input.journalLineId))
  );
  await db.insert(unmatchedLedgerClassifications).values({
    tenantId: session.tenantId,
    bankAccountId: input.bankAccountId,
    journalLineId: input.journalLineId,
    classification: input.classification,
    notes: input.notes.trim() || null,
    classifiedBy: session.userId,
  });

  revalidatePath("/bank-reconciliation");
}

// ---------- Reconciliation sessions ----------

export async function markReconciled(input: { bankAccountId: string; periodStart: string; periodEnd: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");

  const workspace = await getReconciliationWorkspace(input.bankAccountId);

  await db.insert(bankReconciliations).values({
    tenantId: session.tenantId,
    bankAccountId: input.bankAccountId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    statementBalance: workspace.statementBalance.toFixed(2),
    ledgerBalance: workspace.ledgerBalance.toFixed(2),
    status: "reconciled",
    reconciledBy: session.userId,
    reconciledAt: new Date(),
  });

  revalidatePath("/bank-reconciliation");
}

// Admin-only unlock, no separate approval step — the action itself is
// recorded (who/when/reason) so it stays auditable.
export async function reopenReconciliation(input: { reconciliationId: string; reason: string }) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) throw new Error("Only an admin can reopen a reconciled period");
  if (!input.reason.trim()) throw new Error("A reason is required to reopen a reconciliation");

  const [reconciliation] = await db
    .select()
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.id, input.reconciliationId), eq(bankReconciliations.tenantId, session.tenantId)))
    .limit(1);
  if (!reconciliation) throw new Error("Reconciliation not found");

  await db
    .update(bankReconciliations)
    .set({ status: "reopened", reopenedBy: session.userId, reopenedAt: new Date(), reopenReason: input.reason.trim() })
    .where(eq(bankReconciliations.id, input.reconciliationId));

  revalidatePath("/bank-reconciliation");
}

export async function listReconciliationHistory(bankAccountId: string) {
  const session = await requireTenantSession();
  return db
    .select()
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.tenantId, session.tenantId), eq(bankReconciliations.bankAccountId, bankAccountId)))
    .orderBy(desc(bankReconciliations.createdAt));
}
