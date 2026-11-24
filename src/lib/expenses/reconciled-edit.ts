import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { expenses, journalEntries, journalLines, recurringExpenses } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { expenseSupplierAccountId, getOrCreateExpensePayableAccount, getOrCreateTdsPayableAccount } from "@/lib/ledger/expense-accounts";
import { assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { postJournalEntry, reverseJournalEntry, reversalDateFor, type PostLineInput } from "@/lib/ledger/post";
import { reconciledEntryIds } from "@/lib/ledger/reconciled-entries";
import { resettleParty } from "@/lib/ledger/party-settlement";
import { buildPostingLines, computeExpenseTotals, tdsHeadForExpense, validateExpenseInput, type ExpenseBillType, type ExpenseInput, type ExpensePaymentLine, type ExpenseTaxTreatment } from "./expense-records";

const round2 = (n: number) => Math.round(n * 100) / 100;
type ExpenseRow = typeof expenses.$inferSelect;

/** The entry that booked the expense when it was entered (the earliest one still standing); changes made after a reconciliation are posted as later entries on the same source. */
async function mainEntry(tenantId: string, expenseId: string) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "expense"), eq(journalEntries.sourceId, expenseId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)))
    .orderBy(asc(journalEntries.createdAt))
    .limit(1);
  return entry ?? null;
}

/** The payments recorded with the expense when it was entered, read back from its entry (the credit lines that are not tax or the amount still owed). */
export async function storedExpensePayments(tenantId: string, expense: ExpenseRow): Promise<ExpensePaymentLine[]> {
  const entry = await mainEntry(tenantId, expense.id);
  if (!entry) return [];
  const [tdsPayable, expensePayable] = await Promise.all([getOrCreateTdsPayableAccount(tenantId), getOrCreateExpensePayableAccount(tenantId)]);
  const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
  return lines
    .filter((l) => Number(l.creditAmount) > 0 && l.accountId !== tdsPayable.id && l.accountId !== expensePayable.id && l.accountId !== expense.payableAccountId)
    .map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount), modeId: l.paymentModeId }));
}

/** Whether the expense's entries have a line that was matched to a bank statement or ticked in a cash reconciliation. */
export async function isExpenseReconciled(tenantId: string, expenseId: string): Promise<boolean> {
  const active = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, expenseId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)));
  if (active.length === 0) return false;
  return (await reconciledEntryIds(tenantId, active.map((e) => e.id))).size > 0;
}

export type ReconciledExpenseEdit = {
  expenseId: string;
  categoryAccountId: string;
  vendorId: string | null;
  description: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  billAvailable?: boolean;
  /** Why the category or supplier is being changed: required then, recorded with the change. */
  reason?: string;
};

/**
 * Editing an expense whose entries have been reconciled. Its date, amounts and payment accounts are what was reconciled and cannot change; the category, the
 * supplier, the description and the invoice details can. Moving the category or the supplier (the unpaid part is owed on the supplier's own account) is posted
 * as a small entry that moves only that part, dated the expense's own day when that period is open, otherwise today. It carries the expense as its source, so
 * editing or voiding the expense later takes it back with the rest. A reason is required then and is written to the audit log.
 */
export async function changeReconciledExpense(tenantId: string, userId: string, input: ReconciledExpenseEdit): Promise<{ changed: boolean }> {
  const [existing] = await db.select().from(expenses).where(and(eq(expenses.id, input.expenseId), eq(expenses.tenantId, tenantId))).limit(1);
  if (!existing) throw new Error("Expense not found");
  if (existing.status === "void") throw new Error("A void expense can't be edited");
  if (!(await isExpenseReconciled(tenantId, existing.id))) throw new Error("This expense has not been reconciled, so it can be edited in full.");

  const payments = await storedExpensePayments(tenantId, existing);
  const stored: ExpenseInput = {
    expenseDate: existing.expenseDate,
    categoryAccountId: existing.categoryAccountId,
    vendorId: existing.vendorId,
    description: existing.description ?? "",
    invoiceNumber: existing.invoiceNumber ?? "",
    invoiceDate: existing.invoiceDate ?? "",
    dueDate: existing.dueDate ?? "",
    billType: existing.billType as ExpenseBillType,
    billAvailable: existing.billAvailable ?? true,
    taxTreatment: existing.taxTreatment as ExpenseTaxTreatment,
    taxableAmount: Number(existing.taxableAmount),
    vatAmount: Number(existing.vatAmount),
    tdsAmount: Number(existing.tdsAmount),
    otherTaxAmount: Number(existing.otherTaxAmount),
    payments,
  };
  const next: ExpenseInput = {
    ...stored,
    categoryAccountId: input.categoryAccountId,
    vendorId: input.vendorId || null,
    description: input.description.trim(),
    invoiceNumber: input.invoiceNumber.trim(),
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    ...(input.billAvailable !== undefined ? { billAvailable: input.billAvailable } : {}),
  };
  await validateExpenseInput(tenantId, next, existing.id);
  const totals = computeExpenseTotals(next);

  const categoryChanged = next.categoryAccountId !== existing.categoryAccountId;
  const vendorChanged = (next.vendorId ?? null) !== (existing.vendorId ?? null);
  if (vendorChanged) {
    // Payments made later in Payments settle the old supplier's account; they would be left behind.
    await assertNoLaterPayments(tenantId, "expense", existing.id, "expense").catch(() => {
      throw new Error("Payments have been recorded against this expense in Payments, so its supplier can't change. The category and details can.");
    });
  }

  // Where the unpaid part is owed after the change.
  const [recurring] = existing.payableAccountId && !next.vendorId ? await db.select({ id: recurringExpenses.id }).from(recurringExpenses).where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.payableAccountId, existing.payableAccountId))).limit(1) : [];
  const payableAccountId = recurring ? existing.payableAccountId : await expenseSupplierAccountId(tenantId, next.vendorId);

  // The tax withheld is owed under a heading that follows the category: moving it to a category with another heading would move a filed figure.
  if (categoryChanged && totals.tdsAmount > 0) {
    const [before, after] = await Promise.all([tdsHeadForExpense(tenantId, existing.categoryAccountId, totals.tdsAmount), tdsHeadForExpense(tenantId, next.categoryAccountId, totals.tdsAmount)]);
    if (before !== after) throw new Error("Tax (TDS) was withheld on this expense under the heading of its category, so it can only move to a category with the same heading.");
  }

  // What moves on the books: the difference between the lines the expense has now and the lines it would have. The cash and bank lines are the same in both.
  const net = new Map<string, number>();
  const add = (lines: PostLineInput[], sign: 1 | -1) => {
    for (const l of lines) net.set(l.accountId, round2((net.get(l.accountId) ?? 0) + sign * ((l.debitAmount ?? 0) - (l.creditAmount ?? 0))));
  };
  add(await buildPostingLines(tenantId, existing.expenseNumber, next.categoryAccountId, totals, payments, payableAccountId), 1);
  add(await buildPostingLines(tenantId, existing.expenseNumber, existing.categoryAccountId, totals, payments, existing.payableAccountId), -1);
  const moves = [...net.entries()].filter(([, v]) => v !== 0);

  const detailsChanged =
    next.description !== stored.description ||
    next.invoiceNumber !== stored.invoiceNumber ||
    next.invoiceDate !== stored.invoiceDate ||
    next.dueDate !== stored.dueDate ||
    (next.billAvailable ?? true) !== (stored.billAvailable ?? true);
  if (moves.length === 0 && !categoryChanged && !vendorChanged && !detailsChanged) return { changed: false };

  const reason = (input.reason ?? "").trim();
  if ((moves.length > 0 || categoryChanged || vendorChanged) && !reason) throw new Error("Say why this is being changed: an expense that has been reconciled can still move to another category or supplier, and the reason is recorded with it.");

  let entryId: string | null = null;
  if (moves.length > 0) {
    const entryDate = await reversalDateFor(tenantId, existing.expenseDate, moves.map(([id]) => id));
    await assertPeriodOpen(tenantId, entryDate);
    const entry = await postJournalEntry({
      tenantId,
      entryDate,
      sourceType: "expense",
      sourceId: existing.id,
      referenceNumber: existing.expenseNumber,
      memo: `Expense ${existing.expenseNumber} — changed after reconciliation: ${reason}`,
      createdBy: userId,
      lines: moves.map(([accountId, v]) => (v > 0 ? { accountId, debitAmount: v, description: reason } : { accountId, creditAmount: -v, description: reason })),
    });
    entryId = entry.id;
  }

  try {
    await db
      .update(expenses)
      .set({
        categoryAccountId: next.categoryAccountId,
        vendorId: next.vendorId,
        payableAccountId,
        tdsHeadKey: await tdsHeadForExpense(tenantId, next.categoryAccountId, totals.tdsAmount),
        description: next.description || null,
        invoiceNumber: next.invoiceNumber || null,
        invoiceDate: next.invoiceDate || null,
        dueDate: next.dueDate || null,
        ...(input.billAvailable !== undefined ? { billAvailable: input.billAvailable } : {}),
      })
      .where(and(eq(expenses.id, existing.id), eq(expenses.tenantId, tenantId)));
  } catch (e) {
    if (entryId) await reverseJournalEntry(tenantId, entryId, userId, `Change to expense ${existing.expenseNumber} could not be completed`).catch(() => {});
    throw e;
  }
  if (vendorChanged) {
    await resettleParty(tenantId, "supplier", existing.vendorId).catch(() => {});
    await resettleParty(tenantId, "supplier", next.vendorId).catch(() => {});
  }

  await logAuditEvent({
    tenantId,
    userId,
    action: "expense_changed_after_reconciliation",
    entityType: "expense",
    entityId: existing.id,
    before: { expense: existing.expenseNumber, category: existing.categoryAccountId, supplier: existing.vendorId ?? "—" },
    after: { expense: existing.expenseNumber, category: next.categoryAccountId, supplier: next.vendorId ?? "—", ...(reason ? { reason } : {}) },
  });
  return { changed: true };
}
