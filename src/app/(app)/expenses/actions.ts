"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { expenses, journalEntries, journalLines, payments, paymentAllocations } from "@/db/schema";
import { getCurrentTaxRate } from "@/lib/compliance/tax-rates";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseAllActiveEntriesForSource, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { assertCashBankAccounts, assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { assertSourceNotReconciled } from "@/lib/ledger/reconciliation-guards";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";

import { getOrCreateTdsPayableAccount, getOrCreateExpensePayableAccount } from "@/lib/ledger/expense-accounts";
import { withPaymentNumber } from "@/lib/payment-number";
import {
  assertSupplierIfUnpaid,
  buildPostingLines,
  computeExpenseTotals,
  createExpenseCore,
  validateExpenseInput,
  type ExpenseBillType,
  type ExpenseInput,
  type ExpensePaymentLine,
  type ExpenseTaxTreatment,
} from "@/lib/expenses/expense-records";

import { todayIso } from "@/lib/calendar";
const round2 = (n: number) => Math.round(n * 100) / 100;

export type { ExpenseTaxTreatment, ExpensePaymentLine, ExpenseBillType, ExpenseInput } from "@/lib/expenses/expense-records";

// One expense per Save. The writing itself is shared with Import Expenses (lib/expenses/expense-records.ts).
export async function createExpense(input: ExpenseInput) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  const { warnings } = await createExpenseCore({ tenantId: session.tenantId, userId: session.userId }, input);

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/journal");

  return { warnings };
}

/** `detailsOnly`: payments have been recorded against this expense in Payments, so its amounts can't change under them. */
export type ExpenseEditData = ExpenseInput & { expenseId: string; expenseNumber: string; detailsOnly: boolean };

export async function getExpenseForEdit(expenseId: string): Promise<ExpenseEditData> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, session.tenantId)))
    .limit(1);
  if (!expense) throw new Error("Expense not found");
  if (expense.status === "void") throw new Error("A void expense can't be edited");
  const detailsOnly = await assertNoLaterPayments(session.tenantId, "expense", expenseId, "expense").then(() => false, () => true);

  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, session.tenantId),
        eq(journalEntries.sourceType, "expense"),
        eq(journalEntries.sourceId, expenseId),
        eq(journalEntries.isReversed, false)
      )
    )
    .limit(1);

  const tdsPayable = await getOrCreateTdsPayableAccount(session.tenantId);
  const expensePayable = await getOrCreateExpensePayableAccount(session.tenantId);
  let payments: ExpensePaymentLine[] = [];
  if (entry) {
    const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
    payments = lines
      .filter((l) => Number(l.creditAmount) > 0 && l.accountId !== tdsPayable.id && l.accountId !== expensePayable.id)
      .map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount) }));
  }

  return {
    expenseId: expense.id,
    expenseNumber: expense.expenseNumber,
    expenseDate: expense.expenseDate,
    categoryAccountId: expense.categoryAccountId,
    vendorId: expense.vendorId,
    description: expense.description ?? "",
    invoiceNumber: expense.invoiceNumber ?? "",
    invoiceDate: expense.invoiceDate ?? "",
    dueDate: expense.dueDate ?? "",
    billType: expense.billType as ExpenseBillType,
    billAvailable: expense.billAvailable ?? true,
    taxTreatment: expense.taxTreatment as ExpenseTaxTreatment,
    taxableAmount: Number(expense.taxableAmount),
    vatAmount: Number(expense.vatAmount),
    tdsAmount: Number(expense.tdsAmount),
    otherTaxAmount: Number(expense.otherTaxAmount),
    payments,
    detailsOnly,
  };
}

export type UpdateExpenseInput = ExpenseInput & { expenseId: string };

export async function updateExpense(input: UpdateExpenseInput) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.expenseId), eq(expenses.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Expense not found");
  if (existing.status === "void") throw new Error("Cannot edit a void expense");
  // Payments made when the expense was entered are part of it and are edited with it; payments recorded later in
  // Payments are not — void those first (or change only the details).
  await assertNoLaterPayments(session.tenantId, "expense", input.expenseId, "expense");

  await validateExpenseInput(session.tenantId, input, input.expenseId);
  const totals = computeExpenseTotals(input);
  assertSupplierIfUnpaid(input.vendorId, totals);
  // Both the new date and today (the reversal's date) must be open — checked before anything is reversed, so a
  // closed period can't leave the expense half-edited.
  await assertPeriodOpen(session.tenantId, input.expenseDate);
  await assertPeriodOpen(session.tenantId, todayIso());

  await reverseAllActiveEntriesForSource(session.tenantId, input.expenseId, session.userId, `Edit of expense ${existing.expenseNumber}`);

  await db
    .update(expenses)
    .set({
      expenseDate: input.expenseDate,
      categoryAccountId: input.categoryAccountId,
      vendorId: input.vendorId,
      description: input.description.trim() || null,
      invoiceNumber: input.invoiceNumber.trim() || null,
      invoiceDate: input.invoiceDate || null,
      dueDate: input.dueDate || null,
      billType: input.billType,
      ...(input.billAvailable !== undefined ? { billAvailable: input.billAvailable } : {}),
      taxTreatment: input.taxTreatment,
      taxableAmount: totals.subtotal.toFixed(2),
      vatAmount: totals.vatAmount.toFixed(2),
      tdsAmount: totals.tdsAmount.toFixed(2),
      otherTaxAmount: totals.otherTaxAmount.toFixed(2),
      subtotal: totals.subtotal.toFixed(2),
      total: totals.total.toFixed(2),
      amountPayable: totals.amountPayable.toFixed(2),
      amountPaid: totals.paid.toFixed(2),
      status: totals.status,
    })
    .where(eq(expenses.id, input.expenseId));

  const lines = await buildPostingLines(session.tenantId, existing.expenseNumber, input.categoryAccountId, totals, input.payments);
  await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: input.expenseDate,
    sourceType: "expense",
    sourceId: input.expenseId,
    referenceNumber: existing.expenseNumber,
    memo: `Expense ${existing.expenseNumber} (edited)`,
    createdBy: session.userId,
    lines,
  });

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export type ExpenseDetailsInput = { expenseId: string; description: string; invoiceNumber: string; invoiceDate: string; dueDate: string; billAvailable?: boolean };

/**
 * Changes the parts of an expense that don't touch the books — description, the supplier's invoice number and dates,
 * whether the bill is in hand — so it works on any expense, including ones that have payments recorded against them.
 */
export async function updateExpenseDetails(input: ExpenseDetailsInput) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.expenseId), eq(expenses.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Expense not found");
  if (existing.status === "void") throw new Error("A void expense can't be edited");

  const invoiceNumber = input.invoiceNumber.trim();
  if (input.dueDate && input.dueDate < (input.invoiceDate || existing.expenseDate)) throw new Error("The due date can't be before the invoice date");
  if (invoiceNumber && existing.vendorId) {
    const same = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.tenantId, session.tenantId), eq(expenses.vendorId, existing.vendorId), eq(expenses.invoiceNumber, invoiceNumber), ne(expenses.status, "void")));
    if (same.some((e) => e.id !== existing.id)) throw new Error(`Invoice ${invoiceNumber} has already been recorded for this supplier`);
  }

  await db
    .update(expenses)
    .set({
      description: input.description.trim() || null,
      invoiceNumber: invoiceNumber || null,
      invoiceDate: input.invoiceDate || null,
      dueDate: input.dueDate || null,
      ...(input.billAvailable !== undefined ? { billAvailable: input.billAvailable } : {}),
    })
    .where(eq(expenses.id, input.expenseId));

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
}

// Settles some or all of an expense's outstanding Expense Payable balance —
// a separate "payment"-sourced entry, never touching the expense category
// account, so paying an expense never creates a second expense.
export async function recordExpensePayment(input: { expenseId: string; payments: ExpensePaymentLine[]; paymentDate?: string }) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.expenseId), eq(expenses.tenantId, session.tenantId)))
    .limit(1);
  if (!expense) throw new Error("Expense not found");
  if (expense.status === "void") throw new Error("Cannot record a payment against a void expense");

  const paymentDate = input.paymentDate || todayIso();
  if (paymentDate > todayIso()) throw new Error("The payment date can't be in the future");
  if (paymentDate < expense.expenseDate) throw new Error("The payment date can't be before the expense date");

  const remaining = round2(Number(expense.amountPayable) - Number(expense.amountPaid));
  const paidNow = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paidNow <= 0) throw new Error("Enter at least one payment amount");
  if (paidNow > remaining + 0.004) throw new Error("Payment exceeds the outstanding balance");

  await assertCashBankAccounts(session.tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  await assertPeriodOpen(session.tenantId, paymentDate);

  const expensePayable = await getOrCreateExpensePayableAccount(session.tenantId);
  const lines: PostLineInput[] = [
    { accountId: expensePayable.id, debitAmount: paidNow, description: `Payment for expense ${expense.expenseNumber}` },
  ];
  for (const p of input.payments.filter((p) => p.accountId && p.amount > 0)) {
    lines.push({ accountId: p.accountId, creditAmount: round2(p.amount), description: `Payment for expense ${expense.expenseNumber}` });
  }

  const entry = await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: paymentDate,
    sourceType: "payment",
    sourceId: expense.id,
    referenceNumber: expense.expenseNumber,
    memo: `Payment for expense ${expense.expenseNumber}`,
    createdBy: session.userId,
    lines,
  });

  // The entry is posted; if recording it on the expense fails, take the entry back so the books stay consistent.
  try {
    const newPaid = round2(Number(expense.amountPaid) + paidNow);
    const newStatus = newPaid >= Number(expense.amountPayable) ? "paid" : "partially_paid";
    await db.update(expenses).set({ amountPaid: newPaid.toFixed(2), status: newStatus }).where(eq(expenses.id, expense.id));

    const primaryLine = input.payments.filter((p) => p.accountId && p.amount > 0)[0];
    const [paymentRow] = await withPaymentNumber(session.tenantId, "money_out", (paymentNumber) =>
      db
      .insert(payments)
      .values({
        tenantId: session.tenantId,
        paymentNumber,
        direction: "money_out",
        paymentType: "expense_payment",
        paymentDate,
        partyType: expense.vendorId ? "supplier" : expense.payeeName ? "other" : "none",
        vendorId: expense.vendorId,
        partyOtherName: expense.vendorId ? null : expense.payeeName,
        accountId: primaryLine.accountId,
        paymentMethod: "cash",
        referenceNumber: expense.expenseNumber,
        amount: paidNow.toFixed(2),
        description: `Payment for expense ${expense.expenseNumber}`,
        status: "posted",
        origin: "standalone",
        journalEntryId: entry.id,
        createdBy: session.userId,
        postedBy: session.userId,
        postedAt: new Date(),
      })
      .returning()
    );
    await db.insert(paymentAllocations).values({ paymentId: paymentRow.id, targetType: "expense", targetId: expense.id, allocatedAmount: paidNow.toFixed(2) });
  } catch (e) {
    await db.update(expenses).set({ amountPaid: expense.amountPaid, status: expense.status }).where(eq(expenses.id, expense.id));
    await reverseJournalEntry(session.tenantId, entry.id, session.userId, "Rolled back — payment could not be recorded").catch(() => {});
    throw e;
  }

  revalidatePath("/expenses");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

// Marks every Payment-module row recorded for this expense as voided
// (without reversing their journal entries again — reverseAllActiveEntriesForSource
// above already reversed the underlying entries) so the Payments list
// reflects the expense's void immediately rather than showing a stale
// "posted" payment pointing at a reversed entry.
async function voidPaymentsForExpense(tenantId: string, expenseId: string, userId: string, reason: string) {
  const rows = await db
    .select({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(paymentAllocations.targetType, "expense"), eq(paymentAllocations.targetId, expenseId), ne(payments.status, "voided")));

  const paymentIds = [...new Set(rows.map((r) => r.paymentId))];
  for (const id of paymentIds) {
    await db.update(payments).set({ status: "voided", voidReason: reason, voidedBy: userId, voidedAt: new Date() }).where(eq(payments.id, id));
  }
}

export async function voidExpense(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "void")) throw new Error("Not permitted");

  const expenseId = String(formData.get("expenseId"));
  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, session.tenantId)))
    .limit(1);
  if (!expense) throw new Error("Expense not found");
  if (expense.status === "void") throw new Error("Expense is already void");
  await assertSourceNotReconciled(session.tenantId, expenseId, "expense");

  await reverseAllActiveEntriesForSource(session.tenantId, expenseId, session.userId, `Void of expense ${expense.expenseNumber}`);
  await voidPaymentsForExpense(session.tenantId, expenseId, session.userId, `Void of expense ${expense.expenseNumber}`);
  await db.update(expenses).set({ status: "void" }).where(eq(expenses.id, expenseId));

  revalidatePath("/expenses");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

// A starting suggestion only, shown before the expense date is finalized — the accountant can always change the
// VAT/TDS amount by hand, so this is not the source of what actually gets posted.
export async function getExpenseTaxDefaults() {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "view")) throw new Error("Not permitted");
  const [vatRate, tdsRate] = await Promise.all([getCurrentTaxRate(session.tenantId, "vat"), getCurrentTaxRate(session.tenantId, "tds")]);
  return { vatRate, tdsRate };
}
