import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankReconciliationMatchJournalLines, bankReconciliationMatches, cashDifferenceExplanations, cashReconciliationLines, cashReconciliations, daybookCashCounts, expenses, journalEntries, journalLines, users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { todayIso } from "@/lib/calendar";
import { postJournalEntry, reverseAllActiveEntriesForSource } from "./post";
import { createExpenseCore, discardExpense, type ExpenseInput } from "@/lib/expenses/expense-records";
import { findShortExcessAccount, getOrCreateShortExcessAccount } from "./cash-short-excess";
import { adjustmentLines, describeCash, explainState, explanationLines, inOf, isBankLedgerCode, netOf, openLines, outOf, reconcileMethodOf, settle, tickedTotals, type CashLine } from "./cash-reconcile-rules";

// Reconciling a cash account against real cash (see cash-reconcile-rules.ts). Plain server helpers, deliberately not server actions: the actions in
// bank-reconciliation/cash-actions.ts check the permission first.

export class CashReconError extends Error {}
const fail = (message: string): never => {
  throw new CashReconError(message);
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());

/** Whether a bank-accounts-list entry is reconciled as cash: anything that is not under Bank (1010) is cash or a wallet. */
export const isCashLedgerCode = (code: string) => !isBankLedgerCode(code);

async function cashAccount(tenantId: string, bankAccountId: string) {
  const [found] = await db
    .select({ id: bankAccounts.id, name: bankAccounts.accountName, accountId: bankAccounts.chartOfAccountsLink, code: accounts.code, active: bankAccounts.isActive, stored: bankAccounts.reconcileMethod })
    .from(bankAccounts)
    .innerJoin(accounts, eq(accounts.id, bankAccounts.chartOfAccountsLink))
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenantId, tenantId), eq(accounts.tenantId, tenantId)))
    .limit(1);
  if (!found) return fail("That account was not found.");
  if (reconcileMethodOf(found.code, found.stored) !== "ticking") return fail("This account is reconciled against its bank statement. Change its method to ticking entries to use this screen.");
  // A bank account reconciled by ticking has no cash to count: the balance on its statement or in the bank's app is its proof instead.
  return { ...found, isBank: isBankLedgerCode(found.code) };
}

/** The ledger lines of a bank account that were matched to its statement (and not unmatched since): taken as reconciled when the account ticks instead. */
async function bankMatchedIds(tenantId: string, bankAccountId: string): Promise<Map<string, Date>> {
  const rows = await db
    .select({ id: bankReconciliationMatchJournalLines.journalLineId, at: bankReconciliationMatches.createdAt })
    .from(bankReconciliationMatchJournalLines)
    .innerJoin(bankReconciliationMatches, eq(bankReconciliationMatches.id, bankReconciliationMatchJournalLines.matchId))
    .where(and(eq(bankReconciliationMatches.tenantId, tenantId), eq(bankReconciliationMatches.bankAccountId, bankAccountId), isNull(bankReconciliationMatches.unmatchedAt)));
  return new Map(rows.map((r) => [r.id, r.at]));
}

/**
 * What is already reconciled for an account: ticked in a cash reconciliation, or matched to a bank statement before it was switched to ticking. The matched
 * lines are never part of a cash reconciliation, so their total is added to the opening figure, except what the last reconciliation's closing already holds
 * (lines matched before it was signed off, up to its date).
 */
async function settledLines(tenantId: string, acct: { id: string; accountId: string }, all: readonly CashLine[], last: { reconciledAt: Date; asOfDate: string } | null) {
  const [cash, matched] = await Promise.all([reconciledIds(tenantId, acct.accountId), bankMatchedIds(tenantId, acct.id)]);
  const done = new Set([...cash, ...matched.keys()]);
  const counted = (l: CashLine) => last !== null && l.date <= last.asOfDate && (matched.get(l.id) as Date) <= last.reconciledAt;
  const matchedNet = (asOf: string) => round2(all.filter((l) => matched.has(l.id) && !cash.has(l.id) && l.date <= asOf && !counted(l)).reduce((s, l) => s + netOf(l), 0));
  return { done, matchedNet };
}

async function loadLines(tenantId: string, accountId: string): Promise<CashLine[]> {
  const rows = await db
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      date: journalEntries.entryDate,
      debit: journalLines.debitAmount,
      credit: journalLines.creditAmount,
      sourceType: journalEntries.sourceType,
      reference: journalEntries.referenceNumber,
      memo: journalEntries.memo,
      isReversed: journalEntries.isReversed,
      reversalOfId: journalEntries.reversalOfId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, accountId)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt));
  return rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit), reference: r.reference || null, memo: r.memo || null }));
}

async function reconciledIds(tenantId: string, accountId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: cashReconciliationLines.journalLineId })
    .from(cashReconciliationLines)
    .innerJoin(cashReconciliations, eq(cashReconciliations.id, cashReconciliationLines.reconId))
    .where(and(eq(cashReconciliationLines.tenantId, tenantId), eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.accountId, accountId), eq(cashReconciliations.status, "reconciled")));
  return new Set(rows.map((r) => r.id));
}

async function lastReconciled(tenantId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(cashReconciliations)
    .where(and(eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.accountId, accountId), eq(cashReconciliations.status, "reconciled")))
    .orderBy(desc(cashReconciliations.reconciledAt))
    .limit(1);
  return row ?? null;
}

/** What the account is really reconciled up to: the latest entry date any of its reconciliations took in. null when nothing has been reconciled. */
export async function reconciledThrough(tenantId: string, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ through: sql<string | null>`max(${cashReconciliations.throughDate})` })
    .from(cashReconciliations)
    .where(and(eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.accountId, accountId), eq(cashReconciliations.status, "reconciled")));
  return row?.through ?? null;
}

export type CountInfo = { id: string; total: number; byNotes: boolean; counter: string; updatedAt: string; remark: string; notes: Record<string, number>; other: number; book: number };

async function loadCount(tenantId: string, accountId: string, day: string): Promise<CountInfo | null> {
  const [row] = await db
    .select({ c: daybookCashCounts, who: users.name })
    .from(daybookCashCounts)
    .leftJoin(users, eq(users.id, daybookCashCounts.countedBy))
    .where(and(eq(daybookCashCounts.tenantId, tenantId), eq(daybookCashCounts.accountId, accountId), eq(daybookCashCounts.countDate, day)))
    .limit(1);
  if (!row) return null;
  return { id: row.c.id, total: Number(row.c.countedTotal), byNotes: Object.keys(row.c.notes as object).length > 0, counter: row.who ?? "", updatedAt: row.c.updatedAt.toISOString(), remark: row.c.remark ?? "", notes: row.c.notes as Record<string, number>, other: Number(row.c.otherAmount), book: Number(row.c.bookBalance) };
}

export type WorkLine = { id: string; date: string; reference: string; label: string; cashIn: number; cashOut: number };

export type CashWorkspace = {
  account: { id: string; name: string; accountId: string };
  asOf: string;
  /** The latest reconciliation: what the account is reconciled up to, its closing, and when and by whom it was done. */
  last: { through: string; closing: number; kind: string; at: string; by: string } | null;
  /** The last reconciliation's closing, plus an opening-balance entry that has not been taken into one yet. */
  opening: number;
  /** A bank account reconciled by ticking: its proof is the balance as per the bank, not a cash count. */
  bank: boolean;
  lines: WorkLine[];
  count: CountInfo | null;
  /** What the ledger holds up to the date, whatever has been ticked. */
  ledgerBalance: number;
  /** The date of the most recent count of this account, when it is not the date being reconciled. */
  otherCountDate: string | null;
  /** Open entries that were ticked in a reconciliation that has since been reopened: offered to be ticked again. */
  remembered: string[];
};

/** The entries still to reconcile for one cash account up to a date, with the opening figure and the count of that day. */
export async function cashWorkspace(tenantId: string, bankAccountId: string, asOf: string): Promise<CashWorkspace> {
  if (!isDate(asOf)) fail("Choose a valid date.");
  const acct = await cashAccount(tenantId, bankAccountId);
  const [all, last, count] = await Promise.all([loadLines(tenantId, acct.accountId), lastReconciled(tenantId, acct.accountId), acct.isBank ? Promise.resolve(null) : loadCount(tenantId, acct.accountId, asOf)]);
  const settled = await settledLines(tenantId, acct, all, last);
  const open = openLines(all, settled.done, asOf);
  const [recent] = count || acct.isBank
    ? []
    : await db
        .select({ day: daybookCashCounts.countDate })
        .from(daybookCashCounts)
        .where(and(eq(daybookCashCounts.tenantId, tenantId), eq(daybookCashCounts.accountId, acct.accountId)))
        .orderBy(desc(daybookCashCounts.countDate))
        .limit(1);
  const reopened = await db
    .select({ ids: cashReconciliations.rememberedIds, at: cashReconciliations.reopenedAt })
    .from(cashReconciliations)
    .where(and(eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.accountId, acct.accountId), eq(cashReconciliations.status, "reopened")));
  const through = await reconciledThrough(tenantId, acct.accountId);
  const [who] = last?.reconciledBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, last.reconciledBy)).limit(1) : [];
  const since = last ? last.reconciledAt.getTime() : 0;
  const openIds = new Set(open.lines.map((l) => l.id));
  const remembered = [...new Set(reopened.filter((r) => r.at && r.at.getTime() > since).flatMap((r) => r.ids ?? []))].filter((id) => openIds.has(id));
  return {
    account: { id: acct.id, name: acct.name, accountId: acct.accountId },
    asOf,
    last: last ? { through: through ?? last.throughDate, closing: Number(last.closing), kind: last.kind, at: last.reconciledAt.toISOString(), by: who?.name ?? "" } : null,
    opening: round2((last ? Number(last.closing) : 0) + open.opening + settled.matchedNet(asOf)),
    bank: acct.isBank,
    lines: open.lines.map((l) => ({ id: l.id, date: l.date, reference: l.reference ?? "", label: describeCash(l), cashIn: inOf(l), cashOut: outOf(l) })),
    count,
    ledgerBalance: round2(all.filter((l) => l.date <= asOf).reduce((s, l) => s + netOf(l), 0)),
    otherCountDate: recent?.day ?? null,
    remembered,
  };
}

/** For the accounts list: where each cash account stands, without loading the entries into the screen. */
export async function cashStatus(tenantId: string, bankAccountId: string) {
  const acct = await cashAccount(tenantId, bankAccountId);
  const today = todayIso();
  const [all, last] = await Promise.all([loadLines(tenantId, acct.accountId), lastReconciled(tenantId, acct.accountId)]);
  const open = openLines(all, (await settledLines(tenantId, acct, all, last)).done, today);
  return { through: await reconciledThrough(tenantId, acct.accountId), closing: last ? Number(last.closing) : null, kind: last?.kind ?? null, unreconciled: open.lines.length };
}

// -------------------------------------------------------------------------------------------------------------------------------------- sign off

export type SignOffInput = {
  bankAccountId: string;
  asOf: string;
  lineIds: string[];
  /** Take the count of that day as the actual cash. */
  useCount: boolean;
  /** Post the difference found at the count to Cash short and excess. */
  adjust: boolean;
  /** A bank account only: the balance as per the bank on that date, the proof instead of a count. Optional. */
  bankBalance?: number | null;
  note: string;
};

/**
 * Marks the closing balance reconciled: the ticked entries are taken, a count (if used) is kept as the proof, and a short or excess, if the person chose to
 * adjust it, is posted to Cash short and excess dated the reconciliation date. All of it is checked first; the adjustment is undone if the record can't be saved.
 */
export async function signOffCash(tenantId: string, userId: string, input: SignOffInput): Promise<{ id: string; closing: number; adjustment: number }> {
  if (!isDate(input.asOf)) fail("Choose a valid date.");
  if (input.asOf > todayIso()) fail("The date can't be in the future.");
  const acct = await cashAccount(tenantId, input.bankAccountId);
  if (!acct.active) fail("This account is not active.");

  const wantsCount = input.useCount && !acct.isBank;
  const [all, last, count] = await Promise.all([loadLines(tenantId, acct.accountId), lastReconciled(tenantId, acct.accountId), wantsCount ? loadCount(tenantId, acct.accountId, input.asOf) : Promise.resolve(null)]);
  if (wantsCount && !count) fail("There is no count of this account on that date.");
  const bankBalance = acct.isBank && input.bankBalance !== null && input.bankBalance !== undefined ? round2(Number(input.bankBalance)) : null;
  if (bankBalance !== null && !Number.isFinite(bankBalance)) fail("Enter the balance as per the bank as a number.");
  const counted = acct.isBank ? bankBalance : count ? count.total : null;
  const settled = await settledLines(tenantId, acct, all, last);
  const done = settled.done;

  const open = openLines(all, done, input.asOf);
  const wanted = new Set(input.lineIds);
  const openIds = new Set(open.lines.map((l) => l.id));
  if ([...wanted].some((id) => !openIds.has(id))) fail("Some of the ticked entries have changed or were reconciled elsewhere. Reload the page and tick them again.");

  if (wanted.size === 0 && (open.lines.length > 0 || counted === null)) fail("Tick the entries you have checked before marking the closing balance as reconciled.");
  // What this reconciliation really reconciles up to: the latest entry it takes in (the cut-off only limits what is shown).
  const throughDate = wanted.size > 0 ? open.lines.filter((l) => wanted.has(l.id)).reduce((d, l) => (l.date > d ? l.date : d), "") : input.asOf;

  const opening = round2((last ? Number(last.closing) : 0) + open.opening + settled.matchedNet(input.asOf));
  const { cashIn, cashOut } = tickedTotals(open.lines, wanted);
  let s;
  try {
    // A bank balance only shows a difference: nothing is posted to cash short and excess for a bank account.
    s = settle({ opening, cashIn, cashOut, counted, adjust: acct.isBank ? false : input.adjust });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not reconcile.");
  }

  const reconId = randomUUID();
  let adjustmentEntryId: string | null = null;
  let adjustmentLineId: string | null = null;
  if (s.adjustment !== 0) {
    const shortExcess = await getOrCreateShortExcessAccount(tenantId);
    const label = s.adjustment < 0 ? `Cash short found at count, ${acct.name}` : `Cash excess found at count, ${acct.name}`;
    // Dated the cut-off, or the day the account is already reconciled through when that is later (nothing is posted before it).
    const reconciledTo = await reconciledThrough(tenantId, acct.accountId);
    const entry = await postJournalEntry({
      tenantId,
      entryDate: reconciledTo && reconciledTo > input.asOf ? reconciledTo : input.asOf,
      sourceType: "manual",
      sourceId: reconId,
      referenceNumber: s.adjustment < 0 ? "CASH-SHORT" : "CASH-EXCESS",
      memo: input.note.trim() ? `${label}: ${input.note.trim()}` : label,
      createdBy: userId,
      lines: adjustmentLines(acct.accountId, shortExcess.id, s.adjustment, label),
    });
    adjustmentEntryId = entry.id;
    const [cashLine] = await db.select({ id: journalLines.id }).from(journalLines).where(and(eq(journalLines.journalEntryId, entry.id), eq(journalLines.accountId, acct.accountId))).limit(1);
    adjustmentLineId = cashLine?.id ?? null;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(cashReconciliations).values({
        id: reconId,
        tenantId,
        bankAccountId: acct.id,
        accountId: acct.accountId,
        asOfDate: input.asOf,
        throughDate,
        opening: opening.toFixed(2),
        tickedIn: cashIn.toFixed(2),
        tickedOut: cashOut.toFixed(2),
        difference: s.difference === null ? null : s.difference.toFixed(2),
        adjustment: s.adjustment.toFixed(2),
        adjustmentEntryId,
        closing: s.closing.toFixed(2),
        kind: s.kind,
        countId: count?.id ?? null,
        countedTotal: counted === null ? null : counted.toFixed(2),
        note: input.note.trim().slice(0, 500) || null,
        reconciledBy: userId,
      });
      // The opening-balance entry that this reconciliation took into its opening is part of it too, so it isn't offered again.
      const openingIds = all.filter((l) => l.sourceType === "opening_balance" && !done.has(l.id) && l.date <= input.asOf).map((l) => l.id);
      const ids = [...wanted, ...openingIds, ...(adjustmentLineId ? [adjustmentLineId] : [])];
      if (ids.length > 0) await tx.insert(cashReconciliationLines).values(ids.map((journalLineId) => ({ tenantId, reconId, journalLineId })));
    });
  } catch (e) {
    if (adjustmentEntryId) await reverseAllActiveEntriesForSource(tenantId, reconId, userId, "Rolled back: the cash reconciliation could not be saved").catch(() => {});
    const err = e as { code?: string; cause?: { code?: string } };
    if (err?.code === "23505" || err?.cause?.code === "23505") fail("Some of those entries were reconciled by someone else a moment ago. Reload the page.");
    throw e;
  }

  await logAuditEvent({
    tenantId,
    userId,
    action: "cash_reconciled",
    entityType: "cash_reconciliation",
    entityId: reconId,
    after: { account: acct.name, asOf: input.asOf, throughDate, opening, cashIn, cashOut, closing: s.closing, kind: s.kind, counted, bank: acct.isBank, adjustment: s.adjustment },
  });
  return { id: reconId, closing: s.closing, adjustment: s.adjustment };
}

/** The reconciliations of an account from the one given up to the latest, newest first: what unlocking an entry of that one reopens. */
async function chainFrom(tenantId: string, accountId: string, reconId: string) {
  const all = await db
    .select()
    .from(cashReconciliations)
    .where(and(eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.accountId, accountId), eq(cashReconciliations.status, "reconciled")))
    .orderBy(desc(cashReconciliations.reconciledAt));
  const at = all.findIndex((r) => r.id === reconId);
  return at < 0 ? [] : all.slice(0, at + 1);
}

/**
 * Unlocks by reopening: the reconciliation given and every later one of the same account, newest first (the caller checks that the person may). The ticked
 * entries become open and are remembered, so the next reconciliation can tick them again. A short or excess that was posted stays in the books.
 */
export async function reopenCashBackTo(tenantId: string, userId: string, reconId: string, reason: string): Promise<{ reopened: number }> {
  const [recon] = await db.select().from(cashReconciliations).where(and(eq(cashReconciliations.id, reconId), eq(cashReconciliations.tenantId, tenantId))).limit(1);
  if (!recon || recon.status !== "reconciled") return fail("That reconciliation was not found.");
  if (!reason.trim()) fail("Say why it is being unlocked.");
  const chain = await chainFrom(tenantId, recon.accountId, recon.id);
  await db.transaction(async (tx) => {
    for (const r of chain) {
      const lines = await tx.select({ id: cashReconciliationLines.journalLineId }).from(cashReconciliationLines).where(and(eq(cashReconciliationLines.tenantId, tenantId), eq(cashReconciliationLines.reconId, r.id)));
      await tx.delete(cashReconciliationLines).where(and(eq(cashReconciliationLines.tenantId, tenantId), eq(cashReconciliationLines.reconId, r.id)));
      await tx
        .update(cashReconciliations)
        .set({ status: "reopened", reopenedBy: userId, reopenedAt: new Date(), reopenReason: reason.trim().slice(0, 300), rememberedIds: lines.map((l) => l.id) })
        .where(and(eq(cashReconciliations.id, r.id), eq(cashReconciliations.tenantId, tenantId)));
    }
  });
  for (const r of chain) await logAuditEvent({ tenantId, userId, action: "cash_reconciliation_reopened", entityType: "cash_reconciliation", entityId: r.id, after: { asOf: r.asOfDate, reason: reason.trim(), unlockedFrom: recon.asOfDate } });
  return { reopened: chain.length };
}

export type CashLockInfo = CashLock & { canUnlock: boolean };

export type CashLock = { reconId: string; bankAccountId: string; accountName: string; asOf: string; /** the reconciliations that unlocking reopens, newest first */ reopens: string[] };

/** Whether a document's cash line is locked by a cash reconciliation, and what unlocking it would reopen. null when it is not locked. */
export async function getCashLock(tenantId: string, sourceId: string): Promise<CashLock | null> {
  const [hit] = await db
    .select({ reconId: cashReconciliations.id, bankAccountId: cashReconciliations.bankAccountId, accountId: cashReconciliations.accountId, asOf: cashReconciliations.throughDate, name: accounts.name })
    .from(cashReconciliationLines)
    .innerJoin(cashReconciliations, eq(cashReconciliations.id, cashReconciliationLines.reconId))
    .innerJoin(journalLines, eq(journalLines.id, cashReconciliationLines.journalLineId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(accounts, eq(accounts.id, cashReconciliations.accountId))
    .where(and(eq(cashReconciliationLines.tenantId, tenantId), eq(cashReconciliations.status, "reconciled"), eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, sourceId)))
    .orderBy(asc(cashReconciliations.asOfDate))
    .limit(1);
  if (!hit) return null;
  const chain = await chainFrom(tenantId, hit.accountId, hit.reconId);
  return { reconId: hit.reconId, bankAccountId: hit.bankAccountId, accountName: hit.name, asOf: hit.asOf, reopens: chain.map((r) => r.throughDate) };
}

// ------------------------------------------------------------------------------------------------------------------------------------- history

export type HistoryRow = {
  id: string;
  asOf: string;
  /** What it reconciled up to: the latest entry it took in. */
  through: string;
  /** When it was done. */
  doneAt: string;
  /** How many entries it took in. */
  entries: number;
  opening: number;
  closing: number;
  kind: string;
  counted: number | null;
  difference: number | null;
  adjustment: number;
  explained: number;
  remaining: number;
  state: "none" | "open" | "partly" | "explained";
  by: string;
  at: string;
  note: string;
  status: string;
  reopenReason: string;
  latest: boolean;
};

/** How much of each reconciliation's posted short or excess has been explained since, ignoring explanations whose expense or entry was voided. */
async function explainedFor(tenantId: string, reconIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (reconIds.length === 0) return out;
  const rows = await db
    .select({ reconId: cashDifferenceExplanations.reconId, amount: cashDifferenceExplanations.amount, kind: cashDifferenceExplanations.kind, expenseStatus: expenses.status, entryReversed: journalEntries.isReversed })
    .from(cashDifferenceExplanations)
    .leftJoin(expenses, eq(expenses.id, cashDifferenceExplanations.expenseId))
    .leftJoin(journalEntries, eq(journalEntries.id, cashDifferenceExplanations.entryId))
    .where(and(eq(cashDifferenceExplanations.tenantId, tenantId), inArray(cashDifferenceExplanations.reconId, reconIds)));
  for (const r of rows) {
    const stands = r.kind === "expense" ? r.expenseStatus !== "void" : r.entryReversed !== true;
    if (stands) out.set(r.reconId, round2((out.get(r.reconId) ?? 0) + Number(r.amount)));
  }
  return out;
}

export async function cashHistory(tenantId: string, bankAccountId: string): Promise<HistoryRow[]> {
  const acct = await cashAccount(tenantId, bankAccountId);
  const rows = await db
    .select({ r: cashReconciliations, who: users.name })
    .from(cashReconciliations)
    .leftJoin(users, eq(users.id, cashReconciliations.reconciledBy))
    .where(and(eq(cashReconciliations.tenantId, tenantId), eq(cashReconciliations.accountId, acct.accountId)))
    .orderBy(desc(cashReconciliations.reconciledAt));
  const explained = await explainedFor(tenantId, rows.map((x) => x.r.id));
  const voided = await reversedEntries(tenantId, rows.map((x) => x.r.adjustmentEntryId));
  const counts = await entryCounts(tenantId, rows.map((x) => x.r.id));
  const latestId = rows.find((x) => x.r.status === "reconciled")?.r.id;
  return rows.map(({ r, who }) => {
    // A short or excess whose entry was voided is no longer there to explain.
    const standing = !r.adjustmentEntryId || !voided.has(r.adjustmentEntryId);
    const e = explainState(standing ? Number(r.adjustment) : 0, explained.get(r.id) ?? 0);
    return {
      id: r.id,
      asOf: r.asOfDate,
      through: r.throughDate,
      doneAt: r.reconciledAt.toISOString(),
      entries: counts.get(r.id) ?? (r.rememberedIds?.length ?? 0),
      opening: Number(r.opening),
      closing: Number(r.closing),
      kind: r.kind,
      counted: r.countedTotal === null ? null : Number(r.countedTotal),
      difference: r.difference === null ? null : Number(r.difference),
      adjustment: Number(r.adjustment),
      explained: e.explained,
      remaining: e.remaining,
      state: e.state,
      by: who ?? "",
      at: r.reconciledAt.toISOString().slice(0, 10),
      note: r.note ?? "",
      status: r.status,
      reopenReason: r.reopenReason ?? "",
      latest: r.id === latestId,
    };
  });
}

/** How many entries each reconciliation took in. */
async function entryCounts(tenantId: string, reconIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (reconIds.length === 0) return out;
  const rows = await db
    .select({ reconId: cashReconciliationLines.reconId, n: sql<number>`count(*)::int` })
    .from(cashReconciliationLines)
    .innerJoin(journalLines, eq(journalLines.id, cashReconciliationLines.journalLineId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    // The opening-balance entry is part of the opening figure, not an entry that was ticked.
    .where(and(eq(cashReconciliationLines.tenantId, tenantId), inArray(cashReconciliationLines.reconId, reconIds), ne(journalEntries.sourceType, "opening_balance")))
    .groupBy(cashReconciliationLines.reconId);
  for (const r of rows) out.set(r.reconId, r.n);
  return out;
}

export type ReconEntry = { date: string; reference: string; label: string; cashIn: number; cashOut: number };

/** The entries one reconciliation took in (for one that was reopened, the ones it had taken in before). */
export async function reconEntries(tenantId: string, reconId: string): Promise<ReconEntry[]> {
  const [recon] = await db.select().from(cashReconciliations).where(and(eq(cashReconciliations.id, reconId), eq(cashReconciliations.tenantId, tenantId))).limit(1);
  if (!recon) return fail("That reconciliation was not found.");
  const ids =
    recon.status === "reconciled"
      ? (await db.select({ id: cashReconciliationLines.journalLineId }).from(cashReconciliationLines).where(and(eq(cashReconciliationLines.tenantId, tenantId), eq(cashReconciliationLines.reconId, reconId)))).map((r) => r.id)
      : recon.rememberedIds ?? [];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      date: journalEntries.entryDate,
      debit: journalLines.debitAmount,
      credit: journalLines.creditAmount,
      sourceType: journalEntries.sourceType,
      reference: journalEntries.referenceNumber,
      memo: journalEntries.memo,
      isReversed: journalEntries.isReversed,
      reversalOfId: journalEntries.reversalOfId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.id, ids), ne(journalEntries.sourceType, "opening_balance")))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt));
  return rows.map((r) => {
    const l: CashLine = { ...r, debit: Number(r.debit), credit: Number(r.credit), reference: r.reference || null, memo: r.memo || null };
    return { date: l.date, reference: l.reference ?? "", label: describeCash(l), cashIn: inOf(l), cashOut: outOf(l) };
  });
}

async function reversedEntries(tenantId: string, ids: (string | null)[]): Promise<Set<string>> {
  const list = ids.filter((x): x is string => Boolean(x));
  if (list.length === 0) return new Set();
  const rows = await db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), inArray(journalEntries.id, list), eq(journalEntries.isReversed, true)));
  return new Set(rows.map((r) => r.id));
}

/** How much is still unexplained over all of an organization's reconciliations: for a reminder. */
export async function unexplainedTotal(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: cashReconciliations.id, adjustment: cashReconciliations.adjustment, entryId: cashReconciliations.adjustmentEntryId })
    .from(cashReconciliations)
    .where(eq(cashReconciliations.tenantId, tenantId));
  const voided = await reversedEntries(tenantId, rows.map((r) => r.entryId));
  const withDiff = rows.filter((r) => Number(r.adjustment) !== 0 && !(r.entryId && voided.has(r.entryId)));
  const explained = await explainedFor(tenantId, withDiff.map((r) => r.id));
  return round2(withDiff.reduce((s, r) => s + explainState(Number(r.adjustment), explained.get(r.id) ?? 0).remaining, 0));
}

// --------------------------------------------------------------------------------------------------------------------------------- explaining

/** A posted short or excess still counts unless its entry was voided. */
async function adjustmentStands(tenantId: string, entryId: string | null): Promise<boolean> {
  if (!entryId) return false;
  const [e] = await db.select({ r: journalEntries.isReversed }).from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.tenantId, tenantId))).limit(1);
  return Boolean(e) && !e.r;
}

async function loadRecon(tenantId: string, reconId: string) {
  const [recon] = await db.select().from(cashReconciliations).where(and(eq(cashReconciliations.id, reconId), eq(cashReconciliations.tenantId, tenantId))).limit(1);
  if (!recon) return fail("That reconciliation was not found.");
  const adjustment = Number(recon.adjustment);
  if (adjustment === 0) fail("Nothing was posted at that reconciliation, so there is nothing to explain.");
  if (recon.status !== "reconciled" && !(await adjustmentStands(tenantId, recon.adjustmentEntryId))) fail("That short or excess was undone, so there is nothing to explain.");
  const explained = (await explainedFor(tenantId, [recon.id])).get(recon.id) ?? 0;
  return { recon, adjustment, state: explainState(adjustment, explained) };
}

/** What the Explain screens need: the amount still unexplained and where it sits. */
export async function explainContext(tenantId: string, reconId: string) {
  const { recon, adjustment, state } = await loadRecon(tenantId, reconId);
  const shortExcess = await findShortExcessAccount(tenantId);
  return { reconId: recon.id, asOf: recon.asOfDate, adjustment, remaining: state.remaining, shortExcessAccountId: shortExcess?.id ?? null, shortExcessName: shortExcess?.name ?? "Cash Short and Excess" };
}

/**
 * A shortage found later to be an expense: recorded as a real expense (category, supplier, bill, VAT, TDS) that is settled from the Cash short and excess
 * account instead of from cash, so the cash, which already agrees with the count, is not touched.
 */
export async function explainWithExpense(ctx: { tenantId: string; userId: string }, reconId: string, input: ExpenseInput, amount: number) {
  const { recon, adjustment, state } = await loadRecon(ctx.tenantId, reconId);
  if (adjustment > 0) fail("That was an excess, not a shortage. Explain it as cash that was received and not recorded.");
  const amt = round2(amount);
  if (!(amt > 0)) fail("Enter how much of the shortage this explains.");
  if (amt > state.remaining + 0.004) fail(`Only ${state.remaining.toFixed(2)} of this shortage is still unexplained.`);
  const shortExcess = await getOrCreateShortExcessAccount(ctx.tenantId);
  const created = await createExpenseCore(ctx, { ...input, payments: [{ accountId: shortExcess.id, amount: amt }] }, { allowAccountIds: [shortExcess.id] });
  try {
    await db.insert(cashDifferenceExplanations).values({ tenantId: ctx.tenantId, reconId: recon.id, kind: "expense", expenseId: created.expenseId, amount: amt.toFixed(2), explainedOn: input.expenseDate, createdBy: ctx.userId });
  } catch (e) {
    await discardExpense(ctx.tenantId, created.expenseId, ctx.userId);
    throw e;
  }
  await logAuditEvent({ tenantId: ctx.tenantId, userId: ctx.userId, action: "cash_short_explained", entityType: "cash_reconciliation", entityId: recon.id, after: { expense: created.expenseNumber, amount: amt } });
  return created;
}

/** Income accounts an unrecorded receipt can be moved to. */
export async function incomeAccountOptions(tenantId: string) {
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name, parentId: accounts.parentAccountId }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.category, "income"), eq(accounts.isActive, true))).orderBy(asc(accounts.code));
  const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
  return rows.filter((r) => !parents.has(r.id)).map((r) => ({ id: r.id, label: `${r.code} ${r.name}` }));
}

/** An excess found later to be cash that was received and not recorded: moved from Cash short and excess to the income account it belongs to. */
export async function explainExcess(ctx: { tenantId: string; userId: string }, reconId: string, input: { accountId: string; amount: number; date: string; note: string }) {
  const { recon, adjustment, state } = await loadRecon(ctx.tenantId, reconId);
  if (adjustment < 0) fail("That was a shortage, not an excess. Explain it by recording the expense.");
  if (!isDate(input.date) || input.date > todayIso()) fail("Choose a valid date, not in the future.");
  const amt = round2(input.amount);
  if (!(amt > 0)) fail("Enter how much of the excess this explains.");
  if (amt > state.remaining + 0.004) fail(`Only ${state.remaining.toFixed(2)} of this excess is still unexplained.`);
  const options = await incomeAccountOptions(ctx.tenantId);
  if (!options.some((o) => o.id === input.accountId)) fail("Choose an income account.");
  const shortExcess = await getOrCreateShortExcessAccount(ctx.tenantId);
  const label = `Excess cash explained${input.note.trim() ? `: ${input.note.trim()}` : ""}`;
  const entry = await postJournalEntry({
    tenantId: ctx.tenantId,
    entryDate: input.date,
    sourceType: "manual",
    referenceNumber: "CASH-EXCESS",
    memo: label,
    createdBy: ctx.userId,
    lines: explanationLines(shortExcess.id, input.accountId, adjustment, amt, label),
  });
  await db.insert(cashDifferenceExplanations).values({ tenantId: ctx.tenantId, reconId: recon.id, kind: "income", entryId: entry.id, amount: amt.toFixed(2), explainedOn: input.date, note: input.note.trim().slice(0, 300) || null, createdBy: ctx.userId });
  await logAuditEvent({ tenantId: ctx.tenantId, userId: ctx.userId, action: "cash_excess_explained", entityType: "cash_reconciliation", entityId: recon.id, after: { amount: amt, account: input.accountId } });
  return { entryId: entry.id };
}
