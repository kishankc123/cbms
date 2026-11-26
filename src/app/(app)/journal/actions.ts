"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { assertEntryNotReconciled } from "@/lib/ledger/reconciliation-guards";
import { resettleForAccounts } from "@/lib/ledger/party-settlement";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { validateADDate } from "@/lib/calendar";
import { issueVoucher } from "@/lib/ledger/voucher";
import { listJournal, type JournalFilters } from "@/lib/ledger/journal-list";
import { isOwnEntry, REVERSE_REFUSAL } from "@/lib/ledger/journal-rules";
import { exportDateColumns, exportDateHeaders } from "@/lib/calendar";

export type ManualEntryInput = {
  /** Business date, AD "YYYY-MM-DD" (the picker converts from BS if needed). */
  entryDate: string;
  description: string;
  lines: { accountId: string; debitAmount: number; creditAmount: number }[];
};

export type ManualEntryResult = { ok: true; voucherNumber: string; entryId: string; entryDate: string } | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createManualJournalEntry(input: ManualEntryInput): Promise<ManualEntryResult> {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "create")) return { ok: false, error: "Not permitted" };

  // Everything that can be checked up front is, BEFORE a voucher number is issued,
  // so a rejected entry does not use one up.
  if (!validateADDate(input.entryDate)) return { ok: false, error: "Enter the entry date." };
  const lines = input.lines
    .map((l) => ({ accountId: l.accountId, debitAmount: round2(l.debitAmount || 0), creditAmount: round2(l.creditAmount || 0) }))
    .filter((l) => l.accountId && (l.debitAmount > 0 || l.creditAmount > 0));
  if (lines.length < 2) return { ok: false, error: "An entry needs at least two lines." };
  if (lines.some((l) => l.debitAmount > 0 && l.creditAmount > 0)) return { ok: false, error: "A line can't have both a debit and a credit." };
  const debit = round2(lines.reduce((s, l) => s + l.debitAmount, 0));
  const credit = round2(lines.reduce((s, l) => s + l.creditAmount, 0));
  if (debit !== credit) return { ok: false, error: `Debits (${debit.toFixed(2)}) and credits (${credit.toFixed(2)}) must be equal.` };

  const ids = [...new Set(lines.map((l) => l.accountId))];
  const found = await db.select({ id: accounts.id, isActive: accounts.isActive, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, session.tenantId), inArray(accounts.id, ids)));
  if (found.length !== ids.length) return { ok: false, error: "One of the accounts was not found." };
  const inactive = found.find((a) => !a.isActive);
  if (inactive) return { ok: false, error: `Account "${inactive.name}" is inactive.` };

  try {
    await assertPeriodOpen(session.tenantId, input.entryDate);
    const voucherNumber = await issueVoucher(session.tenantId);
    const entry = await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.entryDate,
      sourceType: "manual",
      memo: input.description.trim(),
      referenceNumber: voucherNumber,
      createdBy: session.userId,
      lines,
    });
    await resettleForAccounts(session.tenantId, ids);
    revalidatePath("/journal");
    revalidatePath("/dashboard");
    return { ok: true, voucherNumber, entryId: entry.id, entryDate: input.entryDate };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The entry could not be posted." };
  }
}

export async function reverseEntry(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "void")) throw new Error("Not permitted");
  const journalEntryId = String(formData.get("journalEntryId"));
  const [entry] = await db
    .select({ sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId, referenceNumber: journalEntries.referenceNumber, reversalOfId: journalEntries.reversalOfId })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, journalEntryId), eq(journalEntries.tenantId, session.tenantId)))
    .limit(1);
  if (!entry) throw new Error("Journal entry not found");
  // Only an entry typed in on this screen is reversed here: reversing any other would leave its document saying one thing and the books another.
  if (!isOwnEntry(entry)) throw new Error(REVERSE_REFUSAL);
  if (entry.reversalOfId) throw new Error("This entry is itself a reversal.");
  await assertEntryNotReconciled(session.tenantId, journalEntryId, "entry");
  const touched = await db.select({ accountId: journalLines.accountId }).from(journalLines).where(eq(journalLines.journalEntryId, journalEntryId));
  await reverseJournalEntry(session.tenantId, journalEntryId, session.userId);
  await resettleForAccounts(session.tenantId, touched.map((l) => l.accountId));
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}

const PAGE = 50;
const EXPORT_MAX = 5000;

/** One page of the Entries list. */
export async function listEntriesAction(input: { filters: JournalFilters; offset?: number }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  return listJournal(session.tenantId, input.filters, { limit: PAGE, offset: Math.max(input.offset ?? 0, 0) });
}

/** The filtered list as spreadsheet rows, one for each debit or credit line, so the columns add up. */
export async function exportEntriesAction(filters: JournalFilters) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const { rows, hasMore } = await listJournal(session.tenantId, filters, { limit: EXPORT_MAX });
  const header = [...exportDateHeaders("BOTH"), "Voucher", "Narration", "Source", "Status", "Account code", "Account", "Line note", "Debit", "Credit", "Entered by"];
  const body = rows.flatMap((r) =>
    r.lines.map((l): (string | number)[] => [...exportDateColumns("BOTH", r.date), r.voucher, r.narration, r.source, r.state, l.code, l.name, l.note, l.debit || "", l.credit || "", r.enteredBy])
  );
  return { rows: [header, ...body], entries: rows.length, cut: hasMore };
}
