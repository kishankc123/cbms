"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { expenses, journalEntries, journalLines, tenants, payments, paymentAllocations } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseAllActiveEntriesForSource, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { assertCashBankAccounts, assertSupplierOwned, assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { assertSourceNotReconciled } from "@/lib/ledger/reconciliation-guards";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { getExpenseCategoryAccounts, getOrCreateTdsPayableAccount, getOrCreateExpensePayableAccount } from "@/lib/ledger/expense-accounts";
import { withPaymentNumber } from "@/lib/payment-number";
import { evaluateAmountThresholdRules } from "../compliance/actions";

import { todayIso } from "@/lib/calendar";
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ExpenseTaxTreatment = "taxable" | "exempt" | "zero_rated";
export type ExpensePaymentLine = { accountId: string; amount: number };
export type ExpenseBillType = "vat" | "pan" | "estimate" | "challan" | "no_bill";

export type ExpenseInput = {
  expenseDate: string;
  categoryAccountId: string;
  vendorId: string | null;
  description: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  billType: ExpenseBillType;
  billAvailable?: boolean;
  taxTreatment: ExpenseTaxTreatment;
  taxableAmount: number;
  vatAmount: number;
  tdsAmount: number;
  otherTaxAmount: number;
  payments: ExpensePaymentLine[];
};

async function validateExpenseInput(tenantId: string, input: ExpenseInput, excludeExpenseId?: string) {
  if (input.taxableAmount <= 0) throw new Error("Taxable amount must be greater than zero");
  if (input.vatAmount < 0 || input.tdsAmount < 0 || input.otherTaxAmount < 0) throw new Error("VAT, TDS and other tax amounts can't be negative");
  if (!input.expenseDate) throw new Error("Expense date is required");
  if (input.dueDate && input.dueDate < (input.invoiceDate || input.expenseDate)) throw new Error("The due date can't be before the invoice date");
  // VAT can only be recorded against a VAT bill.
  if (input.billType !== "vat" && round2(input.vatAmount) > 0) throw new Error("VAT can only be recorded when the bill type is VAT");
  // VAT can only be charged on a taxable supply.
  if (input.taxTreatment !== "taxable" && round2(input.vatAmount) > 0) {
    throw new Error(`VAT can't be charged on ${input.taxTreatment === "exempt" ? "an exempt" : "a zero-rated"} expense — set the VAT to 0 or change the tax treatment`);
  }

  const categoryAccounts = await getExpenseCategoryAccounts(tenantId);
  const category = categoryAccounts.find((a) => a.id === input.categoryAccountId);
  if (!category) throw new Error("Select a valid expense category — it must be an active Fixed/Variable expense account, and a category that has sub-categories can't be used itself: choose one of its sub-categories");

  if (input.vendorId) await assertSupplierOwned(tenantId, input.vendorId);
  await assertCashBankAccounts(tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));

  // The same supplier's invoice can't be recorded twice.
  const invoiceNumber = input.invoiceNumber.trim();
  if (invoiceNumber && input.vendorId) {
    const sameInvoice = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), eq(expenses.vendorId, input.vendorId), eq(expenses.invoiceNumber, invoiceNumber), ne(expenses.status, "void")));
    if (sameInvoice.some((e) => e.id !== excludeExpenseId)) throw new Error(`Invoice ${invoiceNumber} has already been recorded for this supplier`);
  }

  return category;
}

// A supplier is only needed while something is still owed: an expense paid in full needs no supplier.
function assertSupplierIfUnpaid(vendorId: string | null, totals: ReturnType<typeof computeExpenseTotals>) {
  if (!vendorId && round2(totals.amountPayable - totals.paid) > 0) {
    throw new Error("Select a supplier — the unpaid balance needs someone it is owed to (a supplier isn't needed once it is paid in full)");
  }
}

function computeExpenseTotals(input: ExpenseInput) {
  const subtotal = round2(input.taxableAmount);
  const vatAmount = round2(input.vatAmount);
  const tdsAmount = round2(input.tdsAmount);
  const otherTaxAmount = round2(input.otherTaxAmount);
  const total = round2(subtotal + vatAmount + otherTaxAmount);
  const amountPayable = round2(total - tdsAmount);
  if (amountPayable < 0) throw new Error("TDS and other withholdings cannot exceed the total expense amount");

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > amountPayable + 0.004) throw new Error("Recorded payment exceeds the amount payable");
  const status = amountPayable > 0 && paid >= amountPayable ? "paid" : paid > 0 ? "partially_paid" : "unpaid";

  return { subtotal, vatAmount, tdsAmount, otherTaxAmount, total, amountPayable, paid, status } as const;
}

// VAT on the expense is input VAT: with an active VAT registration it is claimed (Tax Receivable), otherwise it is
// simply part of what the expense cost.
async function buildPostingLines(
  tenantId: string,
  expenseNumber: string,
  categoryAccountId: string,
  totals: ReturnType<typeof computeExpenseTotals>,
  payments: ExpensePaymentLine[]
): Promise<PostLineInput[]> {
  const claimVat = totals.vatAmount > 0 && (await inputVatClaimable(tenantId));
  const lines: PostLineInput[] = [
    { accountId: categoryAccountId, debitAmount: claimVat ? round2(totals.total - totals.vatAmount) : totals.total, description: `Expense ${expenseNumber}` },
  ];
  if (claimVat) {
    const taxReceivable = await findControlAccount(tenantId, ["1300"], "Tax Receivable");
    if (!taxReceivable) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
    lines.push({ accountId: taxReceivable.id, debitAmount: totals.vatAmount, description: `VAT on expense ${expenseNumber}` });
  }

  if (totals.tdsAmount > 0) {
    const tdsPayable = await getOrCreateTdsPayableAccount(tenantId);
    lines.push({ accountId: tdsPayable.id, creditAmount: totals.tdsAmount, description: `TDS on expense ${expenseNumber}` });
  }

  const remaining = round2(totals.amountPayable - totals.paid);
  if (remaining > 0) {
    const expensePayable = await getOrCreateExpensePayableAccount(tenantId);
    lines.push({ accountId: expensePayable.id, creditAmount: remaining, description: `Expense ${expenseNumber}` });
  }

  for (const p of payments.filter((p) => p.accountId && p.amount > 0)) {
    lines.push({ accountId: p.accountId, creditAmount: round2(p.amount), description: `Expense ${expenseNumber}` });
  }

  return lines;
}

// A failed save must not leave an expense behind without its accounting.
async function discardExpense(tenantId: string, expenseId: string, userId: string) {
  await reverseAllActiveEntriesForSource(tenantId, expenseId, userId, "Rolled back — expense could not be saved").catch(() => {});
  await db.delete(expenses).where(eq(expenses.id, expenseId));
}

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export async function createExpense(input: ExpenseInput) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");

  await validateExpenseInput(session.tenantId, input);
  const totals = computeExpenseTotals(input);
  assertSupplierIfUnpaid(input.vendorId, totals);
  await assertPeriodOpen(session.tenantId, input.expenseDate);
  const warnings = await evaluateAmountThresholdRules(session.tenantId, "expenses", totals.total);

  // The number is EXP-#### and unique per organization: pick the next free one, and if two people save at the
  // same instant the database's unique rule makes the loser pick again.
  let expense: typeof expenses.$inferSelect | undefined;
  let expenseNumber = "";
  for (let attempt = 0; attempt < 5 && !expense; attempt++) {
    const existing = await db.select({ n: expenses.expenseNumber }).from(expenses).where(eq(expenses.tenantId, session.tenantId));
    const taken = new Set(existing.map((r) => r.n));
    expenseNumber = nextFreeInvoiceNumber(taken, (n) => `EXP-${String(n).padStart(4, "0")}`, taken.size + 1).number;
    try {
      [expense] = await db
        .insert(expenses)
        .values({
          tenantId: session.tenantId,
          expenseNumber,
          expenseDate: input.expenseDate,
          categoryAccountId: input.categoryAccountId,
          vendorId: input.vendorId,
          description: input.description.trim() || null,
          invoiceNumber: input.invoiceNumber.trim() || null,
          invoiceDate: input.invoiceDate || null,
          dueDate: input.dueDate || null,
          billType: input.billType,
          billAvailable: input.billAvailable ?? null,
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
        .returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  if (!expense) throw new Error("Could not allocate an expense number — please try again");

  try {
    const lines = await buildPostingLines(session.tenantId, expenseNumber, input.categoryAccountId, totals, input.payments);
    await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.expenseDate,
      sourceType: "expense",
      sourceId: expense.id,
      referenceNumber: expenseNumber,
      memo: `Expense ${expenseNumber}`,
      createdBy: session.userId,
      lines,
    });
  } catch (e) {
    await discardExpense(session.tenantId, expense.id, session.userId);
    throw e;
  }

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
  if (!can(session, "expenses", "delete")) throw new Error("Not permitted");

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

export async function getExpenseTaxDefaults() {
  const session = await requireTenantSession();
  const [tenant] = await db
    .select({ vatRate: tenants.vatRate, tdsRate: tenants.tdsRate })
    .from(tenants)
    .where(eq(tenants.id, session.tenantId))
    .limit(1);
  return { vatRate: parseFloat(tenant?.vatRate ?? "0") || 0, tdsRate: parseFloat(tenant?.tdsRate ?? "0") || 0 };
}
