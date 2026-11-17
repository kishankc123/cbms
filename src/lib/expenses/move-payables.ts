import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, journalEntries, journalLines, vendors } from "@/db/schema";
import { assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { todayIso } from "@/lib/calendar";

// Expenses entered before an expense with a supplier was posted to the supplier's own account still have their unpaid part on the shared Expense
// Payable account, so the supplier's page shows nothing for them. This moves the unpaid part across the same way editing the expense would: the
// expense's entry is reversed and posted again with the supplier's account in place of Expense Payable (nothing else on it changes), and the expense
// is marked as owed on that account. Expenses that already have payments recorded against them, or sit in a closed period, are left and listed.

export type MoveItem = { tenantId: string; expenseId: string; number: string; supplier: string; date: string; unpaid: number };
export type MoveSkip = MoveItem & { reason: string };
export type MoveReport = { moved: MoveItem[]; skipped: MoveSkip[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function moveExpensePayables(opts: { tenantId?: string; apply: boolean; userId?: string | null }): Promise<MoveReport> {
  const rows = await db
    .select({ id: expenses.id, tenantId: expenses.tenantId, number: expenses.expenseNumber, date: expenses.expenseDate, vendorId: expenses.vendorId, supplier: vendors.name, payable: expenses.amountPayable, paid: expenses.amountPaid })
    .from(expenses)
    .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
    .where(and(isNull(expenses.payableAccountId), ne(expenses.status, "void"), sql`${expenses.amountPayable} - ${expenses.amountPaid} > 0.004`, opts.tenantId ? eq(expenses.tenantId, opts.tenantId) : undefined))
    .orderBy(asc(expenses.tenantId), asc(expenses.expenseDate), asc(expenses.expenseNumber));

  const report: MoveReport = { moved: [], skipped: [] };
  for (const r of rows) {
    const item: MoveItem = { tenantId: r.tenantId, expenseId: r.id, number: r.number, supplier: r.supplier, date: r.date, unpaid: round2(Number(r.payable) - Number(r.paid)) };
    const skip = (reason: string) => report.skipped.push({ ...item, reason });
    try {
      await assertNoLaterPayments(r.tenantId, "expense", r.id, "expense");
    } catch {
      skip("payments or a bank match are recorded against it");
      continue;
    }
    const expensePayable = await findControlAccount(r.tenantId, ["2340"], "Expense Payable");
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, r.tenantId), eq(journalEntries.sourceType, "expense"), eq(journalEntries.sourceId, r.id), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)))
      .limit(1);
    if (!entry || !expensePayable) {
      skip("its entry could not be found");
      continue;
    }
    const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
    if (!lines.some((l) => l.accountId === expensePayable.id && Number(l.creditAmount) > 0)) {
      skip("its unpaid part is not on Expense Payable");
      continue;
    }
    try {
      await assertPeriodOpen(r.tenantId, entry.entryDate);
      await assertPeriodOpen(r.tenantId, todayIso());
    } catch {
      skip("its period is closed");
      continue;
    }
    if (!opts.apply) {
      report.moved.push(item);
      continue;
    }
    const supplierAccount = await getOrCreateSupplierPayableAccountId(r.tenantId, r.vendorId!);
    const repost: PostLineInput[] = lines.map((l) => ({
      accountId: l.accountId === expensePayable.id ? supplierAccount : l.accountId,
      debitAmount: Number(l.debitAmount) > 0 ? Number(l.debitAmount) : undefined,
      creditAmount: Number(l.creditAmount) > 0 ? Number(l.creditAmount) : undefined,
      description: l.description ?? undefined,
      paymentModeId: l.paymentModeId,
    }));
    const by = opts.userId ?? entry.createdBy;
    await reverseJournalEntry(r.tenantId, entry.id, by, `Unpaid part of expense ${r.number} moved to the supplier's account`);
    await postJournalEntry({ tenantId: r.tenantId, entryDate: entry.entryDate, sourceType: "expense", sourceId: r.id, referenceNumber: entry.referenceNumber ?? r.number, memo: `Expense ${r.number} (moved to the supplier's account)`, createdBy: by, lines: repost });
    await db.update(expenses).set({ payableAccountId: supplierAccount }).where(and(eq(expenses.id, r.id), eq(expenses.tenantId, r.tenantId)));
    report.moved.push(item);
  }
  return report;
}
