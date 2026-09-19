"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, count } from "drizzle-orm";
import { db } from "@/db";
import { expenses, journalEntries, journalLines, tenants, payments, paymentAllocations } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { getExpenseCategoryAccounts, getOrCreateTdsPayableAccount, getOrCreateExpensePayableAccount } from "@/lib/ledger/expense-accounts";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { evaluateAmountThresholdRules } from "../compliance/actions";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ExpenseTaxTreatment = "taxable" | "exempt" | "zero_rated";
export type ExpensePaymentLine = { accountId: string; amount: number };

export type ExpenseInput = {
  expenseDate: string;
  categoryAccountId: string;
  vendorId: string | null;
  payeeName: string;
  description: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  taxTreatment: ExpenseTaxTreatment;
  taxableAmount: number;
  vatAmount: number;
  tdsAmount: number;
  otherTaxAmount: number;
  payments: ExpensePaymentLine[];
};

async function validateExpenseInput(tenantId: string, input: ExpenseInput, excludeExpenseId?: string) {
  if (input.taxableAmount <= 0) throw new Error("Taxable amount must be greater than zero");
  if (!input.vendorId && !input.payeeName.trim()) throw new Error("Select a supplier or enter a payee name");
  if (!input.expenseDate) throw new Error("Expense date is required");

  const categoryAccounts = await getExpenseCategoryAccounts(tenantId);
  const category = categoryAccounts.find((a) => a.id === input.categoryAccountId);
  if (!category) throw new Error("Select a valid expense category — it must be an active Fixed/Variable expense account");

  const invoiceNumber = input.invoiceNumber.trim();
  if (invoiceNumber && input.vendorId) {
    const [dup] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(
        and(
          eq(expenses.tenantId, tenantId),
          eq(expenses.vendorId, input.vendorId),
          eq(expenses.invoiceNumber, invoiceNumber),
          ne(expenses.status, "void")
        )
      )
      .limit(1);
    if (dup && dup.id !== excludeExpenseId) {
      throw new Error(`Invoice ${invoiceNumber} has already been recorded for this supplier`);
    }
  }

  return category;
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

async function buildPostingLines(
  tenantId: string,
  expenseNumber: string,
  categoryAccountId: string,
  totals: ReturnType<typeof computeExpenseTotals>,
  payments: ExpensePaymentLine[]
): Promise<PostLineInput[]> {
  const lines: PostLineInput[] = [
    { accountId: categoryAccountId, debitAmount: totals.total, description: `Expense ${expenseNumber}` },
  ];

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

export async function createExpense(input: ExpenseInput) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");

  await validateExpenseInput(session.tenantId, input);
  const totals = computeExpenseTotals(input);
  const warnings = await evaluateAmountThresholdRules(session.tenantId, "expenses", totals.total);

  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(expenses)
    .where(eq(expenses.tenantId, session.tenantId));
  const expenseNumber = `EXP-${String(existingCount + 1).padStart(4, "0")}`;

  const [expense] = await db
    .insert(expenses)
    .values({
      tenantId: session.tenantId,
      expenseNumber,
      expenseDate: input.expenseDate,
      categoryAccountId: input.categoryAccountId,
      vendorId: input.vendorId,
      payeeName: input.payeeName.trim() || null,
      description: input.description.trim() || null,
      invoiceNumber: input.invoiceNumber.trim() || null,
      invoiceDate: input.invoiceDate || null,
      dueDate: input.dueDate || null,
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

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/journal");

  return { warnings };
}

export type ExpenseEditData = ExpenseInput & { expenseId: string; expenseNumber: string };

export async function getExpenseForEdit(expenseId: string): Promise<ExpenseEditData> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, session.tenantId)))
    .limit(1);
  if (!expense) throw new Error("Expense not found");
  if (Number(expense.amountPaid) > 0) {
    throw new Error("Cannot edit an expense that already has recorded payments — void it instead");
  }

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
    payeeName: expense.payeeName ?? "",
    description: expense.description ?? "",
    invoiceNumber: expense.invoiceNumber ?? "",
    invoiceDate: expense.invoiceDate ?? "",
    dueDate: expense.dueDate ?? "",
    taxTreatment: expense.taxTreatment as ExpenseTaxTreatment,
    taxableAmount: Number(expense.taxableAmount),
    vatAmount: Number(expense.vatAmount),
    tdsAmount: Number(expense.tdsAmount),
    otherTaxAmount: Number(expense.otherTaxAmount),
    payments,
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
  if (Number(existing.amountPaid) > 0) {
    throw new Error("Cannot edit an expense that already has recorded payments — void it instead");
  }

  await validateExpenseInput(session.tenantId, input, input.expenseId);
  const totals = computeExpenseTotals(input);

  await reverseAllActiveEntriesForSource(session.tenantId, input.expenseId, session.userId, `Edit of expense ${existing.expenseNumber}`);

  await db
    .update(expenses)
    .set({
      expenseDate: input.expenseDate,
      categoryAccountId: input.categoryAccountId,
      vendorId: input.vendorId,
      payeeName: input.payeeName.trim() || null,
      description: input.description.trim() || null,
      invoiceNumber: input.invoiceNumber.trim() || null,
      invoiceDate: input.invoiceDate || null,
      dueDate: input.dueDate || null,
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

// Settles some or all of an expense's outstanding Expense Payable balance —
// a separate "payment"-sourced entry, never touching the expense category
// account, so paying an expense never creates a second expense.
export async function recordExpensePayment(input: { expenseId: string; payments: ExpensePaymentLine[] }) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.expenseId), eq(expenses.tenantId, session.tenantId)))
    .limit(1);
  if (!expense) throw new Error("Expense not found");
  if (expense.status === "void") throw new Error("Cannot record a payment against a void expense");

  const remaining = round2(Number(expense.amountPayable) - Number(expense.amountPaid));
  const paidNow = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paidNow <= 0) throw new Error("Enter at least one payment amount");
  if (paidNow > remaining + 0.004) throw new Error("Payment exceeds the outstanding balance");

  const expensePayable = await getOrCreateExpensePayableAccount(session.tenantId);
  const lines: PostLineInput[] = [
    { accountId: expensePayable.id, debitAmount: paidNow, description: `Payment for expense ${expense.expenseNumber}` },
  ];
  for (const p of input.payments.filter((p) => p.accountId && p.amount > 0)) {
    lines.push({ accountId: p.accountId, creditAmount: round2(p.amount), description: `Payment for expense ${expense.expenseNumber}` });
  }

  const entry = await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: new Date().toISOString().slice(0, 10),
    sourceType: "payment",
    sourceId: expense.id,
    referenceNumber: expense.expenseNumber,
    memo: `Payment for expense ${expense.expenseNumber}`,
    createdBy: session.userId,
    lines,
  });

  const newPaid = round2(Number(expense.amountPaid) + paidNow);
  const newStatus = newPaid >= Number(expense.amountPayable) ? "paid" : "partially_paid";
  await db.update(expenses).set({ amountPaid: newPaid.toFixed(2), status: newStatus }).where(eq(expenses.id, expense.id));

  const primaryLine = input.payments.filter((p) => p.accountId && p.amount > 0)[0];
  const paymentNumber = await buildNextPaymentNumber(session.tenantId, "money_out");
  const [paymentRow] = await db
    .insert(payments)
    .values({
      tenantId: session.tenantId,
      paymentNumber,
      direction: "money_out",
      paymentType: "expense_payment",
      paymentDate: new Date().toISOString().slice(0, 10),
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
    .returning();
  await db.insert(paymentAllocations).values({ paymentId: paymentRow.id, targetType: "expense", targetId: expense.id, allocatedAmount: paidNow.toFixed(2) });

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
