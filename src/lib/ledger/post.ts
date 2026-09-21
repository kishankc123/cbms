import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import type { journalSourceTypeEnum } from "@/db/schema/ledger";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertBankPeriodOpen } from "./reconciliation-guards";

import { todayIso } from "@/lib/calendar";
export class UnbalancedEntryError extends Error {
  constructor(totalDebits: number, totalCredits: number) {
    super(
      `Journal entry is not balanced: debits=${totalDebits.toFixed(2)} credits=${totalCredits.toFixed(2)}`
    );
  }
}

export type PostLineInput = {
  accountId: string;
  debitAmount?: number;
  creditAmount?: number;
  description?: string;
};

export type PostJournalEntryInput = {
  tenantId: string;
  /** Calendar date only, "YYYY-MM-DD" — never a Date object, to avoid UTC/local timezone drift. */
  entryDate: string;
  sourceType: (typeof journalSourceTypeEnum.enumValues)[number];
  sourceId?: string;
  referenceNumber?: string;
  memo?: string;
  createdBy: string;
  lines: PostLineInput[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// A posting changes balances everywhere (chart of accounts, customer/supplier pages, reports, dashboard).
// Refresh every cached page so none keeps showing the old figures. Outside a web request (scripts, tests)
// there is no cache to refresh, and that is fine.
function refreshViews() {
  try {
    revalidatePath("/", "layout");
  } catch {
    /* not in a request */
  }
}

/**
 * The single entry point for writing to the ledger. Every transactional module
 * (sales, purchases, expenses, payments, receipts, bank adjustments, manual entry)
 * must go through this function rather than inserting into journal_entries /
 * journal_lines directly — this is what guarantees debits always equal credits
 * and that every posted fact is tenant-scoped.
 */
/**
 * Every account a posting touches must be an ACTIVE account of the same organization. Account ids often
 * arrive from the browser, so this is checked here, in the one place all postings pass through, rather
 * than trusting each form: it stops a crafted request from posting to another organization's account.
 */
export async function assertAccountsUsable(tenantId: string, accountIds: string[]) {
  const ids = [...new Set(accountIds)];
  const found = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids)));
  if (found.length !== ids.length) throw new Error("A line refers to an account that isn't in this organization's Chart of Accounts");
  const inactive = found.find((a) => !a.isActive);
  if (inactive) throw new Error(`Account ${inactive.code} ${inactive.name} is inactive — reactivate it or choose another account`);
}

export async function postJournalEntry(input: PostJournalEntryInput) {
  await assertPeriodOpen(input.tenantId, input.entryDate);

  if (input.lines.length < 2) {
    throw new Error("A journal entry needs at least two lines");
  }

  const totalDebits = round2(input.lines.reduce((sum, l) => sum + (l.debitAmount ?? 0), 0));
  const totalCredits = round2(input.lines.reduce((sum, l) => sum + (l.creditAmount ?? 0), 0));

  if (totalDebits !== totalCredits) {
    throw new UnbalancedEntryError(totalDebits, totalCredits);
  }
  if (totalDebits === 0) {
    throw new Error("Journal entry total cannot be zero");
  }
  for (const line of input.lines) {
    const d = line.debitAmount ?? 0;
    const c = line.creditAmount ?? 0;
    if (d < 0 || c < 0) throw new Error("Journal line amounts cannot be negative");
    if (d > 0 && c > 0) throw new Error("A journal line cannot have both a debit and a credit");
  }

  await assertAccountsUsable(input.tenantId, input.lines.map((l) => l.accountId));
  await assertBankPeriodOpen(input.tenantId, input.entryDate, input.lines.map((l) => l.accountId));

  const posted = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        tenantId: input.tenantId,
        entryDate: input.entryDate,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        referenceNumber: input.referenceNumber,
        memo: input.memo,
        createdBy: input.createdBy,
      })
      .returning();

    await tx.insert(journalLines).values(
      input.lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        debitAmount: (l.debitAmount ?? 0).toFixed(2),
        creditAmount: (l.creditAmount ?? 0).toFixed(2),
        description: l.description,
      }))
    );

    return entry;
  });
  refreshViews();
  return posted;
}

/**
 * Reverses a posted entry with an equal-and-opposite entry (swap debit/credit on
 * each line) rather than deleting it, preserving the audit trail. This is how
 * every correction to posted data must happen — see spec section 5, "No silent
 * deletion of posted transactions."
 */
export async function reverseJournalEntry(
  tenantId: string,
  journalEntryId: string,
  reversedBy: string,
  memo?: string
) {
  const reversalDate = todayIso();
  await assertPeriodOpen(tenantId, reversalDate);

  const reversed = await db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, journalEntryId), eq(journalEntries.tenantId, tenantId)))
      .limit(1);

    if (!original) throw new Error("Journal entry not found");
    if (original.isReversed) throw new Error("Journal entry is already reversed");

    const originalLines = await tx
      .select()
      .from(journalLines)
      .where(eq(journalLines.journalEntryId, journalEntryId));

    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        tenantId,
        entryDate: reversalDate,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        referenceNumber: original.referenceNumber,
        memo: memo ?? `Reversal of entry ${original.id}`,
        createdBy: reversedBy,
        reversalOfId: original.id,
      })
      .returning();

    await tx.insert(journalLines).values(
      originalLines.map((l) => ({
        journalEntryId: reversal.id,
        accountId: l.accountId,
        debitAmount: l.creditAmount,
        creditAmount: l.debitAmount,
        description: l.description ? `Reversal: ${l.description}` : "Reversal",
      }))
    );

    await tx.update(journalEntries).set({ isReversed: true }).where(eq(journalEntries.id, original.id));

    return reversal;
  });
  refreshViews();
  return reversed;
}

/**
 * Finds the single most-recent, still-active entry for a given source and
 * reverses it — a no-op if there isn't one. A reversal entry is itself never
 * marked isReversed, so more than one isReversed=false row can share a
 * sourceId (the latest correct repost, plus older reversal entries sitting
 * inert); only the most recent one is ever "currently in force."
 */
export async function reverseLatestEntryForSource(
  tenantId: string,
  sourceType: (typeof journalSourceTypeEnum.enumValues)[number],
  sourceId: string,
  reversedBy: string,
  memo?: string
) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.isReversed, false)
      )
    )
    .orderBy(desc(journalEntries.createdAt))
    .limit(1);

  if (entry) {
    await reverseJournalEntry(tenantId, entry.id, reversedBy, memo);
  }
}

/**
 * Reverses every still-active entry for a given source, regardless of
 * sourceType — used where a single source can accumulate more than one
 * independent posting over time (e.g. an expense's initial accrual plus
 * one or more later settlement payments), unlike the single "latest entry"
 * pattern above which assumes at most one active entry per sourceType.
 */
export async function reverseAllActiveEntriesForSource(
  tenantId: string,
  sourceId: string,
  reversedBy: string,
  memo?: string
) {
  const activeEntries = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, sourceId), eq(journalEntries.isReversed, false)));

  for (const entry of activeEntries) {
    await reverseJournalEntry(tenantId, entry.id, reversedBy, memo);
  }
}
