"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { assertEntryNotReconciled } from "@/lib/ledger/reconciliation-guards";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { validateADDate } from "@/lib/calendar";
import { issueVoucher } from "@/lib/ledger/voucher";

export type ManualEntryInput = {
  /** Business date, AD "YYYY-MM-DD" (the picker converts from BS if needed). */
  entryDate: string;
  description: string;
  lines: { accountId: string; debitAmount: number; creditAmount: number }[];
};

export type ManualEntryResult = { ok: true; voucherNumber: string } | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createManualJournalEntry(input: ManualEntryInput): Promise<ManualEntryResult> {
  const session = await requireTenantSession();

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
    await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.entryDate,
      sourceType: "manual",
      memo: input.description.trim(),
      referenceNumber: voucherNumber,
      createdBy: session.userId,
      lines,
    });
    revalidatePath("/journal");
    revalidatePath("/dashboard");
    return { ok: true, voucherNumber };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The entry could not be posted." };
  }
}

export async function reverseEntry(formData: FormData) {
  const session = await requireTenantSession();
  const journalEntryId = String(formData.get("journalEntryId"));
  await assertEntryNotReconciled(session.tenantId, journalEntryId, "entry");
  await reverseJournalEntry(session.tenantId, journalEntryId, session.userId);
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}
