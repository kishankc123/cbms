import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, vendors } from "@/db/schema";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { postJournalEntry, reverseJournalEntry, reversalDateFor, type PostLineInput } from "./post";
import { reconciledEntryIds } from "./reconciled-entries";

// Changing who or what a reconciled document is for. The reconciled lines (the cash or bank line, with its date and amount) cannot move, and the entry that
// holds them cannot be reversed, so a change on the other side is posted as a small journal voucher that moves only that part. It carries the document as its
// source, so voiding or editing the document later takes it back with the rest. Used by invoices and bills; expenses and payments do the same in their own
// modules.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The entries of a document that are still in force (not reversed, and not themselves reversals). */
export async function activeEntriesOfSource(tenantId: string, sourceId: string) {
  return db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, sourceId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)));
}

/** Every supplier's own payable account: what is owed to a supplier sits there, so a line on one of them is never a payment that was made. */
export async function supplierPayableAccountIds(tenantId: string): Promise<Set<string>> {
  const rows = await db.select({ id: vendors.payableAccountId }).from(vendors).where(eq(vendors.tenantId, tenantId));
  return new Set(rows.map((r) => r.id).filter((x): x is string => Boolean(x)));
}

/** Whether any of the document's entries has a line matched to a bank statement or ticked in a cash reconciliation. */
export async function isSourceReconciled(tenantId: string, sourceId: string): Promise<boolean> {
  const active = await activeEntriesOfSource(tenantId, sourceId);
  if (active.length === 0) return false;
  return (await reconciledEntryIds(tenantId, active.map((e) => e.id))).size > 0;
}

/** Turns the difference per account (debit minus credit) into the lines of a voucher, leaving out accounts that do not move. */
export function linesFromNet(net: Map<string, number>, description: string): PostLineInput[] {
  const out: PostLineInput[] = [];
  for (const [accountId, v] of net) {
    const x = round2(v);
    if (x > 0) out.push({ accountId, debitAmount: x, description });
    else if (x < 0) out.push({ accountId, creditAmount: -x, description });
  }
  return out;
}

/** Posts the voucher on the document's own day when that period is open, otherwise today, and returns its id. */
export async function postReclass(args: { tenantId: string; userId: string; sourceId: string; referenceNumber: string; memo: string; anchorDate: string; lines: PostLineInput[] }): Promise<string> {
  const entryDate = await reversalDateFor(args.tenantId, args.anchorDate, args.lines.map((l) => l.accountId));
  await assertPeriodOpen(args.tenantId, entryDate);
  const entry = await postJournalEntry({
    tenantId: args.tenantId,
    entryDate,
    sourceType: "manual",
    sourceId: args.sourceId,
    referenceNumber: args.referenceNumber,
    memo: args.memo,
    createdBy: args.userId,
    lines: args.lines,
  });
  return entry.id;
}

/** Takes back the vouchers posted by changes made after a reconciliation, when the document itself is voided or edited in full. */
export async function reverseReclassForSource(tenantId: string, sourceId: string, userId: string, memo: string) {
  const found = (await activeEntriesOfSource(tenantId, sourceId)).filter((e) => e.sourceType === "manual");
  for (const e of found) await reverseJournalEntry(tenantId, e.id, userId, memo);
}
