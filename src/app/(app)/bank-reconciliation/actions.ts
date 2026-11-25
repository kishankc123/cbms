"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, inArray, asc, desc, isNull, sql } from "drizzle-orm";
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
  bankInstitutions,
  tenants,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { logAuditEvent } from "@/lib/audit";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { syncBankOpeningBalanceEntry } from "@/lib/ledger/opening-balance";
import { SYSTEM_ACCOUNT_CODES } from "@/lib/ledger/chart-rules";
import { listInstitutions } from "@/lib/banking/institutions";
import { modesWithLinks, setAccountModes } from "@/lib/payment-modes";
import { createSubGroupEntry, deleteAccountEntry } from "@/lib/ledger/chart";
import { assessReconciliation } from "@/lib/banking/assess";
import { todayIso } from "@/lib/calendar";
import { parseStatementFile } from "@/lib/banking/parse-statement";
import { buildStatementTemplate } from "@/lib/banking/statement-template";
import { normalizeStatementRows, type ColumnMapping } from "@/lib/banking/normalize-rows";
import { findMatchCandidates, type MatchCandidate } from "@/lib/banking/matching";
import { cashStatus } from "@/lib/ledger/cash-reconcile";
import { reconcileMethodOf, type ReconcileMethod } from "@/lib/ledger/cash-reconcile-rules";
import { setReconcileMethod } from "@/lib/ledger/reconcile-method";
import { deleteStatementImport, listStatementImports } from "@/lib/banking/statement-imports";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Bank account setup ----------

export async function getOffsetAccountOptions() {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const rows = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, category: accounts.category, subCategory: accounts.subCategory, parentAccountId: accounts.parentAccountId })
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true)))
    .orderBy(accounts.code);
  // An account with sub-accounts is a heading, not somewhere to post to.
  const parents = new Set(rows.map((r) => r.parentAccountId).filter((id): id is string => Boolean(id)));
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, category: r.category, subCategory: r.subCategory, hasChildren: parents.has(r.id) }));
}

export async function getBankAccountLedgerOptions() {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const linked = await db.select({ id: bankAccounts.chartOfAccountsLink }).from(bankAccounts).where(eq(bankAccounts.tenantId, session.tenantId));
  const linkedIds = new Set(linked.map((r) => r.id));

  const rows = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, parentAccountId: accounts.parentAccountId })
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true), eq(accounts.category, "asset")))
    .orderBy(accounts.code);

  // What can be linked: a Cash or Bank account at the lowest level that no bank account uses yet. (The Bank heading itself is not an account.)
  const parents = new Set(rows.map((r) => r.parentAccountId).filter((id): id is string => Boolean(id)));
  return rows
    .filter((a) => (a.code === "1000" || a.code.startsWith("1000.") || (a.code.startsWith("1010") && a.code !== "1010")) && !parents.has(a.id) && !linkedIds.has(a.id))
    .map((a) => ({ id: a.id, code: a.code, name: a.name }));
}

export async function listBankAccounts() {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const [{ linked }, rows, used] = await Promise.all([modesWithLinks(session.tenantId), listBankAccountRows(session.tenantId), accountsWithHistory(session.tenantId)]);
  return rows.map((r) => ({ ...r, modeIds: linked(r.chartOfAccountsLink), canDelete: !used.has(r.id) && !used.has(r.chartOfAccountsLink) && !SYSTEM_ACCOUNT_CODES.has(r.ledgerCode) }));
}

/** The bank accounts (by their own id) and ledger accounts (by chart id) that have any history: ledger lines, statements or reconciliations. Such an account is deactivated, not deleted. */
async function accountsWithHistory(tenantId: string): Promise<Set<string>> {
  const [lines, imports, reconciled] = await Promise.all([
    db.selectDistinct({ id: journalLines.accountId }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId)).where(eq(journalEntries.tenantId, tenantId)),
    db.selectDistinct({ id: bankStatementImports.bankAccountId }).from(bankStatementImports).where(eq(bankStatementImports.tenantId, tenantId)),
    db.selectDistinct({ id: bankReconciliations.bankAccountId }).from(bankReconciliations).where(eq(bankReconciliations.tenantId, tenantId)),
  ]);
  return new Set([...lines, ...imports, ...reconciled].map((r) => r.id));
}

const listBankAccountRows = (tenantId: string) =>
  db
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
      reconcileMethod: bankAccounts.reconcileMethod,
      institutionId: bankAccounts.institutionId,
      logo: { id: bankInstitutions.id, hasLogo: sql<boolean>`${bankInstitutions.logo} is not null`, updatedAt: bankInstitutions.updatedAt },
      ledgerCode: accounts.code,
      ledgerName: accounts.name,
    })
    .from(bankAccounts)
    .innerJoin(accounts, eq(accounts.id, bankAccounts.chartOfAccountsLink))
    .leftJoin(bankInstitutions, eq(bankInstitutions.id, bankAccounts.institutionId))
    .where(eq(bankAccounts.tenantId, tenantId))
    .orderBy(asc(bankAccounts.accountName));

/** What the Add and Edit window offers: the banks and wallets of this country, and the payment modes (changed only by an Owner or Administrator). */
export async function getBankFormOptions() {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const [t] = await db.select({ country: tenants.countryCode }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const [institutions, { modes }] = await Promise.all([listInstitutions(t?.country ?? ""), modesWithLinks(session.tenantId)]);
  return { institutions, modes, canSetModes: isOrgAdmin(session.role) };
}

export type AccountOverview = {
  id: string;
  label: string;
  accountNumber: string | null;
  currency: string;
  /** "bank" for an account under Bank, "wallet" for the rest of Cash (e-wallets and the like). */
  kind: "bank" | "wallet";
  /** How the account is reconciled: against its uploaded statement, or by ticking the entries (what cash and wallet accounts always do). */
  method: ReconcileMethod;
  statementBalance: number;
  ledgerBalance: number;
  difference: number;
  /** Statement lines still to be matched. */
  unreconciled: number;
  /** The date of the latest statement line, or null when no statement has been imported. */
  updatedUpTo: string | null;
  /** Lines flagged for review. */
  flagged: number;
  /** For cash and wallet accounts: where the reconciliation against the cash itself stands (Bank Reconciliation > the cash screen). */
  cash: { through: string | null; closing: number | null; kind: string | null; unreconciled: number } | null;
};

/** Every active bank and wallet account with where its reconciliation stands, for the Home screen. */
export async function getReconciliationOverview(): Promise<AccountOverview[]> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const accountList = (await listBankAccounts()).filter((b) => b.isActive);
  if (accountList.length === 0) return [];

  const [statement, ledger] = await Promise.all([
    db
      .select({
        id: bankStatementLines.bankAccountId,
        total: sql<string>`coalesce(sum(${bankStatementLines.amount}), 0)`,
        unreconciled: sql<number>`count(*) filter (where ${bankStatementLines.matchStatus} <> 'matched')`,
        latest: sql<string | null>`max(${bankStatementLines.transactionDate})`,
        flagged: sql<number>`count(*) filter (where ${bankStatementLines.flaggedAt} is not null)`,
      })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.tenantId, session.tenantId), inArray(bankStatementLines.bankAccountId, accountList.map((b) => b.id))))
      .groupBy(bankStatementLines.bankAccountId),
    // The account's balance counts every posting, reversed ones and their reversals included: they cancel out.
    db
      .select({ id: journalLines.accountId, net: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(and(eq(journalEntries.tenantId, session.tenantId), inArray(journalLines.accountId, accountList.map((b) => b.chartOfAccountsLink))))
      .groupBy(journalLines.accountId),
  ]);
  const stmt = new Map(statement.map((r) => [r.id, r]));
  const book = new Map(ledger.map((r) => [r.id, Number(r.net)]));

  const cashStates = new Map(await Promise.all(accountList.filter((b) => reconcileMethodOf(b.ledgerCode, b.reconcileMethod) === "ticking").map(async (b) => [b.id, await cashStatus(session.tenantId, b.id)] as const)));

  return accountList.map((b) => {
    const s = stmt.get(b.id);
    const statementBalance = round2(Number(b.openingBalance) + Number(s?.total ?? 0));
    const ledgerBalance = round2(book.get(b.chartOfAccountsLink) ?? 0);
    return {
      id: b.id,
      label: `${b.bankName && b.bankName !== b.accountName ? b.bankName + " — " : ""}${b.accountName}`,
      accountNumber: b.accountNumber,
      currency: b.currency,
      kind: b.ledgerCode.startsWith("1010") ? "bank" : "wallet",
      method: reconcileMethodOf(b.ledgerCode, b.reconcileMethod),
      statementBalance,
      ledgerBalance,
      difference: round2(statementBalance - ledgerBalance),
      unreconciled: Number(s?.unreconciled ?? 0),
      updatedUpTo: s?.latest ?? null,
      flagged: Number(s?.flagged ?? 0),
      cash: cashStates.get(b.id) ?? null,
    };
  });
}

/** Chooses how a bank account is reconciled: against its statement, or by ticking the entries when there is no statement to upload. */
export async function setReconcileMethodAction(input: { bankAccountId: string; method: ReconcileMethod }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  const r = await setReconcileMethod(session.tenantId, session.userId, input.bankAccountId, input.method);
  revalidatePath("/bank-reconciliation");
  revalidatePath(`/bank-reconciliation/${input.bankAccountId}`);
  revalidatePath(`/bank-reconciliation/${input.bankAccountId}/cash`);
  return r;
}

export type BankAccountInput = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  currency: string;
  chartOfAccountsLink: string;
  openingBalance: number;
  /** The bank or wallet picked from the directory; null or missing for one typed by hand (bankName then holds its name). */
  institutionId?: string | null;
  /** The payment modes the account can be used for. Only an Owner or Administrator changes these; for anyone else it is ignored. */
  modeIds?: string[];
};

/** The directory entry for a picked id, which must be one of this organization's country's; its name becomes the bank name. */
async function pickedInstitution(tenantId: string, id: string | null | undefined) {
  if (!id) return null;
  const [t] = await db.select({ country: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const found = (await listInstitutions(t?.country ?? "")).find((i) => i.id === id);
  if (!found) throw new Error("Choose a bank or wallet from the list.");
  return found;
}

// The ledger account a bank account is tied to must be one of this organization's Cash / Bank asset accounts, a lowest-
// level one (not a group that has sub-accounts), and not already used by another bank account.
async function validateBankLedgerAccount(tenantId: string, accountId: string, excludeBankAccountId?: string) {
  const [acc] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId))).limit(1);
  if (!acc) throw new Error("Select a ledger account from this organization's Chart of Accounts");
  if (!acc.isActive) throw new Error(`Ledger account ${acc.code} ${acc.name} is inactive`);
  const cashOrBank = acc.code === "1000" || acc.code.startsWith("1000.") || acc.code.startsWith("1010");
  if (acc.category !== "asset" || !cashOrBank) throw new Error("Link a Cash or Bank account — an asset account under Cash or Bank in the Chart of Accounts");
  if (acc.code === "1010") throw new Error("Bank is the heading that holds your bank accounts, not an account itself. Choose Create a new account to add one under it, or link one of its sub-accounts.");
  const [child] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, acc.id), eq(accounts.isActive, true))).limit(1);
  if (child) throw new Error(`${acc.name} has sub-accounts — link one of its sub-accounts instead`);
  const linked = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.chartOfAccountsLink, acc.id)));
  if (linked.some((b) => b.id !== excludeBankAccountId)) throw new Error("That ledger account is already linked to another bank account");
  return acc;
}

/**
 * Adds a bank account. With no ledger account chosen (`chartOfAccountsLink` empty) a new account is created in the Chart of Accounts under Bank (1010.01,
 * 1010.02...) and linked, so the account is in both places; otherwise an existing Cash or Bank account is linked.
 */
export async function createBankAccount(input: BankAccountInput) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");
  if (!input.accountName.trim()) throw new Error("Account name is required");
  const opening = round2(input.openingBalance);
  const institution = await pickedInstitution(session.tenantId, input.institutionId);
  const details = {
    institutionId: institution?.id ?? null,
    bankName: institution?.name ?? (input.bankName.trim() || null),
    accountName: input.accountName.trim(),
    accountNumber: input.accountNumber.trim() || null,
    branch: input.branch.trim() || null,
    currency: input.currency.trim() || "NPR",
    openingBalance: opening.toFixed(2),
  };

  let ledgerId: string;
  let createdLedger = false;
  let created: typeof bankAccounts.$inferSelect;
  if (input.chartOfAccountsLink) {
    const ledger = await validateBankLedgerAccount(session.tenantId, input.chartOfAccountsLink);
    ledgerId = ledger.id;
    [created] = await db.insert(bankAccounts).values({ tenantId: session.tenantId, ...details, chartOfAccountsLink: ledger.id }).returning();
  } else {
    const [group] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.code, "1010"))).limit(1);
    if (!group) throw new Error("Your Chart of Accounts has no Bank group to put it under. Link an existing account instead.");
    // An account made under Bank gets its bank account record straight away; fill that one in rather than adding a second.
    const ledger = await createSubGroupEntry(session.tenantId, session.userId, { parentAccountId: group.id, name: details.accountName });
    ledgerId = ledger.id;
    createdLedger = true;
    [created] = await db.update(bankAccounts).set(details).where(and(eq(bankAccounts.tenantId, session.tenantId), eq(bankAccounts.chartOfAccountsLink, ledger.id))).returning();
    if (!created) [created] = await db.insert(bankAccounts).values({ tenantId: session.tenantId, ...details, chartOfAccountsLink: ledger.id }).returning();
  }

  // The opening balance is real money in the account: it goes into the ledger too (against Brought forward).
  try {
    await syncBankOpeningBalanceEntry(session.tenantId, created.id, created.accountName, ledgerId, opening, session.userId);
  } catch (e) {
    await db.delete(bankAccounts).where(eq(bankAccounts.id, created.id));
    if (createdLedger) await db.delete(accounts).where(and(eq(accounts.id, ledgerId), eq(accounts.tenantId, session.tenantId))).catch(() => {});
    throw e;
  }
  if (isOrgAdmin(session.role) && input.modeIds) await setAccountModes(session.tenantId, ledgerId, input.modeIds);

  revalidatePath("/bank-reconciliation");
  revalidatePath("/bank-reconciliation/setup");
  revalidatePath("/chart-of-accounts");
  revalidatePath("/journal");
}

export async function updateBankAccount(input: BankAccountInput & { bankAccountId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  if (!input.accountName.trim()) throw new Error("Account name is required");

  const [existing] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Bank account not found");
  const opening = round2(input.openingBalance);
  const institution = await pickedInstitution(session.tenantId, input.institutionId);

  // A changed opening balance is re-posted first, so a refusal (a closed period, say) leaves everything as it was.
  if (Math.abs(opening - Number(existing.openingBalance)) > 0.004) {
    await syncBankOpeningBalanceEntry(session.tenantId, existing.id, input.accountName.trim(), existing.chartOfAccountsLink, opening, session.userId);
  }

  await db
    .update(bankAccounts)
    .set({
      institutionId: institution?.id ?? null,
      bankName: institution?.name ?? (input.bankName.trim() || null),
      accountName: input.accountName.trim(),
      accountNumber: input.accountNumber.trim() || null,
      branch: input.branch.trim() || null,
      currency: input.currency.trim() || "NPR",
      openingBalance: opening.toFixed(2),
    })
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)));
  if (isOrgAdmin(session.role) && input.modeIds) await setAccountModes(session.tenantId, existing.chartOfAccountsLink, input.modeIds);

  revalidatePath("/bank-reconciliation");
  revalidatePath("/bank-reconciliation/setup");
  revalidatePath("/chart-of-accounts");
  revalidatePath("/journal");
}

// Deactivating a bank account also deactivates its linked Chart of Accounts
// row, so it disappears from every RECORD PAY picker app-wide — an inactive
// bank account must not be usable for new transactions anywhere. Only an
// account that is settled (nothing in it) and is not a system account (such as Cash) can be switched off.
export async function setBankAccountActive(input: { bankAccountId: string; isActive: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");

  const [bankAccount] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bankAccount) throw new Error("Bank account not found");

  if (!input.isActive) {
    const [ledger] = await db.select().from(accounts).where(eq(accounts.id, bankAccount.chartOfAccountsLink)).limit(1);
    if (ledger && ledger.parentAccountId === null && SYSTEM_ACCOUNT_CODES.has(ledger.code)) {
      throw new Error(`${ledger.name} is a system account and can't be switched off`);
    }
    const [row] = await db
      .select({ v: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(and(eq(journalEntries.tenantId, session.tenantId), eq(journalLines.accountId, bankAccount.chartOfAccountsLink)));
    const balance = round2(Number(row.v));
    if (Math.abs(balance) > 0.004) throw new Error(`This account still holds ${balance.toFixed(2)} — move it to another account first, then switch it off`);
  }

  await db.update(bankAccounts).set({ isActive: input.isActive }).where(eq(bankAccounts.id, input.bankAccountId));
  await db.update(accounts).set({ isActive: input.isActive }).where(eq(accounts.id, bankAccount.chartOfAccountsLink));

  revalidatePath("/bank-reconciliation");
  revalidatePath("/bank-reconciliation/setup");
  revalidatePath("/chart-of-accounts");
}

/** Deletes a bank account that has no history, together with its account in the Chart of Accounts. One with transactions, statements or reconciliations is deactivated instead. */
export async function deleteBankAccount(input: { bankAccountId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit") || !can(session, "chart_of_accounts", "delete")) throw new Error("Not permitted");
  const [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId))).limit(1);
  if (!bank) throw new Error("Bank account not found");
  if ((await accountsWithHistory(session.tenantId)).has(bank.id)) throw new Error("This account has bank statements or reconciliations, so it can't be deleted. Deactivate it instead.");
  // The Chart of Accounts rules decide the rest: a system account, one with transactions (an opening balance counts) or one still in use is refused in plain words.
  await deleteAccountEntry(session.tenantId, session.userId, bank.chartOfAccountsLink);
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

export async function downloadStatementTemplate(): Promise<{ fileName: string; base64: string }> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");
  return { fileName: "bank-statement-sample.xlsx", base64: buildStatementTemplate() };
}

const MAPPING_FIELDS =["date", "description", "debit", "credit", "amount", "reference", "balance"] as const;

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

export type ConfirmImportInput = {
  bankAccountId: string;
  fileName: string;
  base64: string;
  mapping: ColumnMapping;
  saveAsTemplateName: string;
};

export type ConfirmImportResult = { imported: number; duplicates: number; skipped: number };

export async function confirmStatementImport(input: ConfirmImportInput): Promise<ConfirmImportResult> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");
  if (!input.mapping.date) throw new Error("Map at least the Date column");
  if (!input.mapping.debit && !input.mapping.credit && !input.mapping.amount) {
    throw new Error("Map at least an Amount column, or both Debit and Credit");
  }
  const [bank] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bank) throw new Error("Bank account not found");

  const { headers, rows } = parseStatementFile(input.base64, input.fileName);
  const { valid, skipped } = normalizeStatementRows(headers, rows, input.mapping);
  if (valid.length === 0) throw new Error("No valid transaction rows found with this column mapping. Dates must be written dd/mm/yyyy.");

  const existingHashes = await db
    .select({ hash: bankStatementLines.dedupeHash })
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.tenantId, session.tenantId), eq(bankStatementLines.bankAccountId, input.bankAccountId)));
  const existingSet = new Set(existingHashes.map((r) => r.hash));

  const newRows = valid.filter((r) => !existingSet.has(r.dedupeHash));
  const duplicates = valid.length - newRows.length;
  if (newRows.length === 0) throw new Error("Every row in this file has already been imported for this bank account");

  // New transactions can't appear inside a period that has already been reconciled.
  const reconciled = await db
    .select({ start: bankReconciliations.periodStart, end: bankReconciliations.periodEnd })
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.bankAccountId, input.bankAccountId), eq(bankReconciliations.status, "reconciled")));
  const inLocked = newRows.find((r) => reconciled.some((p) => r.transactionDate >= p.start && r.transactionDate <= p.end));
  if (inLocked) {
    throw new Error(`This statement has a new transaction dated ${inLocked.transactionDate}, inside a period that is already reconciled — reopen that reconciliation first`);
  }

  // The statement's period is what its transactions cover.
  const dateList = newRows.map((r) => r.transactionDate).sort();

  await db.transaction(async (tx) => {
    const [importRow] = await tx
      .insert(bankStatementImports)
      .values({
        tenantId: session.tenantId,
        bankAccountId: input.bankAccountId,
        fileName: input.fileName,
        statementPeriodStart: dateList[0],
        statementPeriodEnd: dateList[dateList.length - 1],
        rowCount: newRows.length,
        status: "confirmed",
      })
      .returning();

    await tx.insert(bankStatementLines).values(
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
      await tx.insert(bankStatementTemplates).values({
        tenantId: session.tenantId,
        bankAccountId: input.bankAccountId,
        name: input.saveAsTemplateName.trim(),
        columnMapping: input.mapping,
      });
    }
  });

  revalidatePath("/bank-reconciliation");
  return { imported: newRows.length, duplicates, skipped };
}

/** The statements uploaded for an account, with whether each can be deleted. */
export async function listStatementImportsAction(bankAccountId: string) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  return listStatementImports(session.tenantId, bankAccountId);
}

/** Removes an uploaded statement (nothing matched, no signed-off reconciliation over it) so a corrected file can be uploaded again. */
export async function deleteStatementImportAction(input: { importId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  const r = await deleteStatementImport(session.tenantId, session.userId, input.importId);
  revalidatePath("/bank-reconciliation");
  return r;
}

// ---------- Reconciliation workspace ----------

export type StatementLineRow = {
  /** Flagged for review, and the note saying why. */
  flagged: boolean;
  flagNote: string | null;
  id: string;
  transactionDate: string;
  description: string | null;
  reference: string | null;
  amount: number;
  matchStatus: string;
  matchId: string | null;
};

/** A ledger entry a confirmed match was made to, for showing beside the bank line. */
export type MatchedEntry = { date: string; text: string; amount: number };

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
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");

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

  const matchedJournalLineIds = await db
    .select({ id: bankReconciliationMatchJournalLines.journalLineId })
    .from(bankReconciliationMatchJournalLines)
    .innerJoin(bankReconciliationMatches, eq(bankReconciliationMatches.id, bankReconciliationMatchJournalLines.matchId))
    .where(and(eq(bankReconciliationMatches.tenantId, session.tenantId), isNull(bankReconciliationMatches.unmatchedAt)));
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

  // What each confirmed match was made to, so the list can show the book entry beside the bank line.
  const matchIds = [...new Set(matchLinesForStatement.map((r) => r.matchId))];
  const matchedEntryRows = matchIds.length
    ? await db
        .select({
          matchId: bankReconciliationMatchJournalLines.matchId,
          date: journalEntries.entryDate,
          memo: journalEntries.memo,
          description: journalLines.description,
          reference: journalEntries.referenceNumber,
          debit: journalLines.debitAmount,
          credit: journalLines.creditAmount,
        })
        .from(bankReconciliationMatchJournalLines)
        .innerJoin(journalLines, eq(journalLines.id, bankReconciliationMatchJournalLines.journalLineId))
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
        .where(and(eq(journalEntries.tenantId, session.tenantId), inArray(bankReconciliationMatchJournalLines.matchId, matchIds)))
    : [];
  const matches: Record<string, MatchedEntry[]> = {};
  for (const r of matchedEntryRows) (matches[r.matchId] ??= []).push({ date: r.date, text: r.memo || r.description || r.reference || "Ledger entry", amount: round2(Number(r.debit) - Number(r.credit)) });

  const statementRows: StatementLineRow[] = statementLines.map((l) => ({
    id: l.id,
    transactionDate: l.transactionDate,
    description: l.description,
    reference: l.reference,
    amount: Number(l.amount),
    matchStatus: l.matchStatus,
    flagged: l.flaggedAt !== null,
    flagNote: l.flagNote,
    matchId: matchIdByStatementLine.get(l.id) ?? null,
  }));

  // The opening balance is posted to the ledger, so the ledger balance is just what the ledger holds.
  const ledgerBalance = round2(allLines.reduce((s, r) => s + Number(r.debitAmount) - Number(r.creditAmount), 0));
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
    matches,
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
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
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

/**
 * "OK all": confirms every exact suggestion in one go. The server works the suggestions out itself, so only matches it would
 * itself call exact are made; a ledger entry is never given to two bank lines, and one that can't be confirmed (a reconciled
 * period, say) is skipped and counted.
 */
export async function confirmExactMatches(bankAccountId: string): Promise<{ confirmed: number; skipped: number }> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  const suggestions = await getSuggestedMatchesForAccount(bankAccountId);
  const used = new Set<string>();
  let confirmed = 0;
  let skipped = 0;
  for (const [statementLineId, c] of Object.entries(suggestions)) {
    if (c.tier !== "exact") continue;
    if (used.has(c.journalLineId)) {
      skipped++;
      continue;
    }
    try {
      await confirmMatch({ bankAccountId, statementLineIds: [statementLineId], journalLineIds: [c.journalLineId], matchType: "exact", confidence: c.score });
      used.add(c.journalLineId);
      confirmed++;
    } catch {
      skipped++;
    }
  }
  return { confirmed, skipped };
}

export async function getSuggestedMatchesForLine(statementLineId: string): Promise<MatchCandidate[]> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const [line] = await db
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, statementLineId), eq(bankStatementLines.tenantId, session.tenantId)))
    .limit(1);
  if (!line) throw new Error("Statement line not found");

  const [bankAccount] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, line.bankAccountId), eq(bankAccounts.tenantId, session.tenantId))).limit(1);
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
// Everything is checked first: the lines must be this organization's and this bank account's, live (not reversed),
// not matched already, and outside any reconciled period; the match itself is saved in one go.
export async function confirmMatch(input: {
  bankAccountId: string;
  statementLineIds: string[];
  journalLineIds: string[];
  matchType: "exact" | "suggested" | "manual";
  confidence?: number;
}) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  const statementIds = [...new Set(input.statementLineIds)];
  const journalIds = [...new Set(input.journalLineIds)];
  if (statementIds.length === 0 || journalIds.length === 0) {
    throw new Error("Select at least one bank line and one ledger line");
  }

  const [bank] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bank) throw new Error("Bank account not found");

  const statementLinesToMatch = await db
    .select()
    .from(bankStatementLines)
    .where(and(inArray(bankStatementLines.id, statementIds), eq(bankStatementLines.tenantId, session.tenantId), eq(bankStatementLines.bankAccountId, bank.id)));
  if (statementLinesToMatch.length !== statementIds.length) throw new Error("One or more bank lines don't belong to this bank account");
  if (statementLinesToMatch.some((l) => l.matchStatus === "matched")) throw new Error("One or more of the bank lines are already matched");

  const journalLinesToMatch = await db
    .select({
      id: journalLines.id,
      debitAmount: journalLines.debitAmount,
      creditAmount: journalLines.creditAmount,
      date: journalEntries.entryDate,
      reversed: journalEntries.isReversed,
      reversal: journalEntries.reversalOfId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(inArray(journalLines.id, journalIds), eq(journalEntries.tenantId, session.tenantId), eq(journalLines.accountId, bank.chartOfAccountsLink)));
  if (journalLinesToMatch.length !== journalIds.length) throw new Error("One or more ledger lines aren't postings to this bank account's ledger account");
  if (journalLinesToMatch.some((l) => l.reversed || l.reversal)) throw new Error("A ledger transaction that has been reversed can't be matched");

  const alreadyMatched = await db
    .select({ id: bankReconciliationMatchJournalLines.id })
    .from(bankReconciliationMatchJournalLines)
    .innerJoin(bankReconciliationMatches, eq(bankReconciliationMatches.id, bankReconciliationMatchJournalLines.matchId))
    .where(and(inArray(bankReconciliationMatchJournalLines.journalLineId, journalIds), eq(bankReconciliationMatches.tenantId, session.tenantId), isNull(bankReconciliationMatches.unmatchedAt)))
    .limit(1);
  if (alreadyMatched.length > 0) throw new Error("One or more of the ledger lines are already matched");

  for (const date of new Set([...statementLinesToMatch.map((l) => l.transactionDate), ...journalLinesToMatch.map((l) => l.date)])) {
    if (await isPeriodLocked(bank.id, date)) throw new Error(`${date} falls inside a reconciled period — reopen that reconciliation first`);
  }

  const statementTotal = round2(statementLinesToMatch.reduce((s, l) => s + Number(l.amount), 0));
  const journalTotal = round2(journalLinesToMatch.reduce((s, l) => s + (Number(l.debitAmount) - Number(l.creditAmount)), 0));
  if (Math.abs(statementTotal - journalTotal) > 0.005) {
    throw new Error(`Selected amounts don't agree (bank ${statementTotal.toFixed(2)} vs ledger ${journalTotal.toFixed(2)})`);
  }

  await db.transaction(async (tx) => {
    const [match] = await tx
      .insert(bankReconciliationMatches)
      .values({
        tenantId: session.tenantId,
        bankAccountId: bank.id,
        matchType: input.matchType,
        confidence: input.confidence !== undefined ? input.confidence.toFixed(2) : null,
        createdBy: session.userId,
      })
      .returning();

    await tx.insert(bankReconciliationMatchLines).values(statementLinesToMatch.map((l) => ({ matchId: match.id, statementLineId: l.id, amountApplied: l.amount })));
    await tx.insert(bankReconciliationMatchJournalLines).values(
      journalLinesToMatch.map((l) => ({ matchId: match.id, journalLineId: l.id, amountApplied: (Number(l.debitAmount) - Number(l.creditAmount)).toFixed(2) }))
    );
    await tx.update(bankStatementLines).set({ matchStatus: "matched" }).where(inArray(bankStatementLines.id, statementIds));
  });

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
  /** Where the money goes (or comes from). Several accounts make a split; together they add up to the amount. */
  splits: { offsetAccountId: string; amount: number }[];
  comment: string;
  /**
   * Book entries that already cover part of this bank line (say five of six receipts, or a deposit less a bank fee). The new
   * transaction is then only for what they leave, and everything is matched to the bank line together.
   */
  alongsideJournalLineIds?: string[];
};

// A unified poster for the "money showed up in the bank but nothing's in the ledger yet" case — posts an entry against the bank's
// ledger account and the chosen offset accounts, then immediately links it (with any entries it sits alongside) to the statement
// line that prompted it, as a manual match. Everything is checked before posting, and if the match can't be made the entry is
// taken back — so a failed attempt never leaves an entry behind for a retry to duplicate.
export async function createBankTransaction(input: CreateBankTransactionInput) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "create")) throw new Error("Not permitted");

  const [bankAccount] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bankAccount) throw new Error("Bank account not found");

  const [line] = await db
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, input.statementLineId), eq(bankStatementLines.tenantId, session.tenantId), eq(bankStatementLines.bankAccountId, bankAccount.id)))
    .limit(1);
  if (!line) throw new Error("Statement line not found on this bank account");
  if (line.matchStatus === "matched") throw new Error("This line is already matched");
  if (await isPeriodLocked(bankAccount.id, line.transactionDate)) throw new Error(`${line.transactionDate} falls inside a reconciled period — reopen that reconciliation first`);

  // What the new entry has to cover: the whole bank line, or what the chosen entries leave of it.
  const alongside = [...new Set(input.alongsideJournalLineIds ?? [])];
  const covered = alongside.length
    ? (
        await db
          .select({ debit: journalLines.debitAmount, credit: journalLines.creditAmount })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
          .where(and(inArray(journalLines.id, alongside), eq(journalEntries.tenantId, session.tenantId), eq(journalLines.accountId, bankAccount.chartOfAccountsLink)))
      ).reduce((sum, r) => sum + Number(r.debit) - Number(r.credit), 0)
    : 0;
  const bankSide = round2(Number(line.amount) - covered);
  if (Math.abs(bankSide) < 0.005) throw new Error("The entries you chose already add up to the whole bank amount, so there is nothing left to record");

  const splits = input.splits.filter((p) => p.offsetAccountId || p.amount);
  if (splits.length === 0) throw new Error("Select the account this transaction belongs to");
  if (splits.some((p) => !(p.amount > 0))) throw new Error("Enter an amount greater than zero for each account");
  const splitTotal = round2(splits.reduce((sum, p) => sum + p.amount, 0));
  if (Math.abs(splitTotal - Math.abs(bankSide)) > 0.005) {
    throw new Error(`The amounts add up to ${splitTotal.toFixed(2)}, but this transaction is for ${Math.abs(bankSide).toFixed(2)}`);
  }

  const offsets = await db
    .select()
    .from(accounts)
    .where(and(inArray(accounts.id, splits.map((p) => p.offsetAccountId)), eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true)));
  for (const p of splits) {
    const offset = offsets.find((o) => o.id === p.offsetAccountId);
    if (!offset) throw new Error("Select the account this transaction belongs to");
    if (offset.id === bankAccount.chartOfAccountsLink) {
      throw new Error("The account can't be the bank account itself — use Payments > Inter-Transfer to move money between your own accounts");
    }
    if (["1100", "2000"].some((c) => offset.code === c || offset.code.startsWith(c + "."))) {
      throw new Error("Customer and supplier accounts are settled through Payments — record a receipt or payment instead");
    }
  }

  const moneyIn = bankSide > 0;
  const memo = input.comment.trim() || "Bank reconciliation";
  const bankLineInput: PostLineInput = moneyIn
    ? { accountId: bankAccount.chartOfAccountsLink, debitAmount: Math.abs(bankSide), description: memo }
    : { accountId: bankAccount.chartOfAccountsLink, creditAmount: Math.abs(bankSide), description: memo };
  const offsetLines: PostLineInput[] = splits.map((p) => (moneyIn ? { accountId: p.offsetAccountId, creditAmount: p.amount, description: memo } : { accountId: p.offsetAccountId, debitAmount: p.amount, description: memo }));

  const entry = await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: line.transactionDate,
    sourceType: "bank_adjustment",
    referenceNumber: line.reference ?? undefined,
    memo,
    createdBy: session.userId,
    lines: [bankLineInput, ...offsetLines],
  });

  try {
    const postedLines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
    const bankLine = postedLines.find((l) => l.accountId === bankAccount.chartOfAccountsLink);
    if (!bankLine) throw new Error("Failed to post the bank side of this transaction");

    await confirmMatch({
      bankAccountId: bankAccount.id,
      statementLineIds: [line.id],
      journalLineIds: [bankLine.id, ...alongside],
      matchType: "manual",
    });
  } catch (e) {
    await reverseJournalEntry(session.tenantId, entry.id, session.userId, "Rolled back — the bank line could not be matched").catch(() => {});
    throw e;
  }

  revalidatePath("/bank-reconciliation");
  revalidatePath("/journal");
}

// ---------- Flagging ----------

const FLAG_NOTE_MAX = 300;

/**
 * Flags a bank line for review, with a note saying why, or takes the flag off. A flag is only a marker for a second look: it has no
 * effect on matching or on the books, so it can be set on a line in a reconciled period too.
 */
export async function setLineFlag(input: { statementLineId: string; flagged: boolean; note?: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");
  const note = (input.note ?? "").trim();
  if (note.length > FLAG_NOTE_MAX) throw new Error(`Keep the note under ${FLAG_NOTE_MAX} characters.`);

  const [line] = await db
    .select({ id: bankStatementLines.id, flaggedAt: bankStatementLines.flaggedAt, flagNote: bankStatementLines.flagNote })
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, input.statementLineId), eq(bankStatementLines.tenantId, session.tenantId)))
    .limit(1);
  if (!line) throw new Error("Statement line not found");

  await db
    .update(bankStatementLines)
    .set(input.flagged ? { flaggedAt: new Date(), flaggedBy: session.userId, flagNote: note || null } : { flaggedAt: null, flaggedBy: null, flagNote: null })
    .where(and(eq(bankStatementLines.id, line.id), eq(bankStatementLines.tenantId, session.tenantId)));
  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: input.flagged ? "bank_line_flagged" : "bank_line_unflagged",
    entityType: "bank_statement_line",
    entityId: line.id,
    before: line.flaggedAt ? { note: line.flagNote } : null,
    after: input.flagged ? { note: note || null } : null,
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

  const [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId))).limit(1);
  if (!bank) throw new Error("Bank account not found");
  const [onBank] = await db
    .select({ id: journalLines.id })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalLines.id, input.journalLineId), eq(journalEntries.tenantId, session.tenantId), eq(journalLines.accountId, bank.chartOfAccountsLink)))
    .limit(1);
  if (!onBank) throw new Error("That ledger transaction isn't on this bank account");

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

const nextDay = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// What marking a bank account reconciled up to a date would record, and what (if anything) stands in the way. A period
// runs from the day after the last reconciled one, so periods never overlap.
export async function previewReconciliation(input: { bankAccountId: string; periodEnd: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");

  const [bank] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId)))
    .limit(1);
  if (!bank) throw new Error("Bank account not found");

  const [last] = await db
    .select({ end: bankReconciliations.periodEnd })
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.bankAccountId, bank.id), eq(bankReconciliations.status, "reconciled")))
    .orderBy(desc(bankReconciliations.periodEnd))
    .limit(1);
  const periodStart = last ? nextDay(last.end) : "2000-01-01";

  const blockers: string[] = [];
  if (!input.periodEnd) blockers.push("Choose the date to reconcile up to.");
  else if (input.periodEnd > todayIso()) blockers.push("The date can't be in the future.");
  else if (last && input.periodEnd <= last.end) blockers.push(`This account is already reconciled up to ${last.end}.`);

  const assessment = await assessReconciliation(session.tenantId, bank, input.periodEnd || todayIso());
  return { periodStart, periodEnd: input.periodEnd, ...assessment, blockers: [...blockers, ...assessment.blockers] };
}

export async function markReconciled(input: { bankAccountId: string; periodEnd: string }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) throw new Error("Not permitted");

  const preview = await previewReconciliation(input);
  if (preview.blockers.length > 0) throw new Error(preview.blockers.join(" "));

  await db.insert(bankReconciliations).values({
    tenantId: session.tenantId,
    bankAccountId: input.bankAccountId,
    periodStart: preview.periodStart,
    periodEnd: input.periodEnd,
    statementBalance: preview.statementBalance.toFixed(2),
    ledgerBalance: preview.ledgerBalance.toFixed(2),
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
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  return db
    .select()
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.tenantId, session.tenantId), eq(bankReconciliations.bankAccountId, bankAccountId)))
    .orderBy(desc(bankReconciliations.createdAt));
}
