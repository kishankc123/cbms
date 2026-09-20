import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { interTransfers, journalLines, journalEntries } from "@/db/schema";
import { postJournalEntry, reverseJournalEntry } from "./post";
import { getCashBankAccounts } from "./cash-bank-accounts";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { buildInvoiceNumber } from "@/lib/invoice-number";

import { todayIso } from "@/lib/calendar";
const round2 = (n: number) => Math.round(n * 100) / 100;

export type TransferAccountOption = { id: string; label: string; kind: "Cash" | "Bank" };

// The only accounts an Inter-Transfer may touch: active Cash/Bank accounts
// (a group with sub-accounts is a heading, not selectable).
export async function getTransferAccountOptions(tenantId: string): Promise<TransferAccountOption[]> {
  const groups = await getCashBankAccounts(tenantId);
  const list: TransferAccountOption[] = [];
  for (const g of groups) {
    const kind = g.code.startsWith("1000") ? "Cash" : "Bank";
    if (g.children.length === 0) list.push({ id: g.id, label: `${g.code} — ${g.name}`, kind });
    else for (const c of g.children) list.push({ id: c.id, label: `${c.code} — ${c.name}`, kind });
  }
  return list;
}

// Ledger balance of an account (debits - credits, every line — reversals
// cancel their originals so no isReversed filtering, see reports.ts).
export async function getAccountLedgerBalance(tenantId: string, accountId: string): Promise<number> {
  const lines = await db
    .select({ debit: journalLines.debitAmount, credit: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, accountId)));
  return round2(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
}

async function nextTransferNumber(tenantId: string) {
  const [{ value }] = await db.select({ value: count() }).from(interTransfers).where(eq(interTransfers.tenantId, tenantId));
  return buildInvoiceNumber("TR", null, value + 1, "prefix-number-suffix");
}

export type TransferInput = {
  transferDate: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  reference?: string | null;
  description?: string | null;
  attachmentUrl?: string | null;
};

async function validate(tenantId: string, input: TransferInput) {
  if (!input.transferDate) throw new Error("Please enter the transfer date.");
  if (!input.fromAccountId) throw new Error("Please select the From Account.");
  if (!input.toAccountId) throw new Error("Please select the To Account.");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero.");
  if (input.fromAccountId === input.toAccountId) throw new Error("From Account and To Account cannot be the same.");

  const allowed = new Set((await getTransferAccountOptions(tenantId)).map((a) => a.id));
  if (!allowed.has(input.fromAccountId) || !allowed.has(input.toAccountId)) {
    throw new Error("Transfers are only allowed between active Cash and Bank accounts.");
  }
}

function entryLines(input: TransferInput, transferNumber: string) {
  const amount = round2(input.amount);
  const memo = `Inter-Transfer ${transferNumber}`;
  return [
    { accountId: input.toAccountId, debitAmount: amount, description: memo },
    { accountId: input.fromAccountId, creditAmount: amount, description: memo },
  ];
}

export async function createTransfer(tenantId: string, userId: string, input: TransferInput) {
  await validate(tenantId, input);
  const transferNumber = await nextTransferNumber(tenantId);

  const entry = await postJournalEntry({
    tenantId,
    entryDate: input.transferDate,
    sourceType: "inter_transfer",
    referenceNumber: transferNumber,
    memo: `Inter-Transfer ${transferNumber}`,
    createdBy: userId,
    lines: entryLines(input, transferNumber),
  });

  try {
    const [row] = await db
      .insert(interTransfers)
      .values({
        tenantId,
        transferNumber,
        transferDate: input.transferDate,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: round2(input.amount).toFixed(2),
        reference: input.reference?.trim() || null,
        description: input.description?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
        journalEntryId: entry.id,
        createdBy: userId,
      })
      .returning();
    return row;
  } catch (e) {
    // The record insert failed (e.g. a concurrent duplicate number) — undo
    // the just-posted entry so a journal entry never exists without its
    // transfer.
    await reverseJournalEntry(tenantId, entry.id, userId, `Rollback of failed transfer ${transferNumber}`);
    throw e instanceof Error && /unique/i.test(e.message) ? new Error("Another transfer was saved at the same time — please try again.") : e;
  }
}

// Editing reverses the old entry and posts a fresh one, then re-points the
// transfer at it — so exactly one entry is ever in force for the transfer.
export async function updateTransfer(tenantId: string, userId: string, transferId: string, input: TransferInput) {
  const [existing] = await db.select().from(interTransfers).where(and(eq(interTransfers.id, transferId), eq(interTransfers.tenantId, tenantId))).limit(1);
  if (!existing) throw new Error("Transfer not found");
  if (existing.status === "voided") throw new Error("A voided transfer cannot be edited.");

  await validate(tenantId, input);
  // Check every period the edit touches up front so it can't half-apply.
  await assertPeriodOpen(tenantId, existing.transferDate);
  await assertPeriodOpen(tenantId, input.transferDate);
  await assertPeriodOpen(tenantId, todayIso());

  const entry = await postJournalEntry({
    tenantId,
    entryDate: input.transferDate,
    sourceType: "inter_transfer",
    referenceNumber: existing.transferNumber,
    memo: `Inter-Transfer ${existing.transferNumber} (edited)`,
    createdBy: userId,
    lines: entryLines(input, existing.transferNumber),
  });
  await reverseJournalEntry(tenantId, existing.journalEntryId, userId, `Edit of transfer ${existing.transferNumber}`);

  await db
    .update(interTransfers)
    .set({
      transferDate: input.transferDate,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: round2(input.amount).toFixed(2),
      reference: input.reference?.trim() || null,
      description: input.description?.trim() || null,
      attachmentUrl: input.attachmentUrl?.trim() || null,
      journalEntryId: entry.id,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(interTransfers.id, transferId));
}

export async function voidTransfer(tenantId: string, userId: string, transferId: string, reason: string) {
  const [existing] = await db.select().from(interTransfers).where(and(eq(interTransfers.id, transferId), eq(interTransfers.tenantId, tenantId))).limit(1);
  if (!existing) throw new Error("Transfer not found");
  if (existing.status === "voided") throw new Error("Transfer is already voided.");

  await reverseJournalEntry(tenantId, existing.journalEntryId, userId, `Void of transfer ${existing.transferNumber}: ${reason}`);
  await db
    .update(interTransfers)
    .set({ status: "voided", voidReason: reason, voidedBy: userId, voidedAt: new Date() })
    .where(eq(interTransfers.id, transferId));
}
