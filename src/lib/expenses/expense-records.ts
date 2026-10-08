import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { assertCashBankAccounts, assertSupplierOwned } from "@/lib/ledger/account-guards";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { getExpenseCategoryAccounts, getOrCreateTdsPayableAccount, getOrCreateExpensePayableAccount } from "@/lib/ledger/expense-accounts";
import { evaluateAmountThresholdRules } from "@/lib/audit-rules";

// An expense: the rules, the amounts and the ledger entry. They live here so the Add form, the edit form and Import Expenses
// all post the same way. Kept out of the "use server" action file so these are plain helpers, not callable endpoints.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ExpenseTaxTreatment = "taxable" | "exempt" | "zero_rated";
export type ExpensePaymentLine = { accountId: string; amount: number; modeId?: string | null };
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

export async function validateExpenseInput(tenantId: string, input: ExpenseInput, excludeExpenseId?: string) {
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
  if (!category) throw new Error("Select a valid expense category — it must be an active Direct/Indirect expense account, and a category that has sub-categories can't be used itself: choose one of its sub-categories");

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

export function computeExpenseTotals(input: ExpenseInput) {
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

// A supplier is only needed while something is still owed: an expense paid in full needs no supplier.
export function assertSupplierIfUnpaid(vendorId: string | null, totals: ReturnType<typeof computeExpenseTotals>) {
  if (!vendorId && round2(totals.amountPayable - totals.paid) > 0) {
    throw new Error("Select a supplier — the unpaid balance needs someone it is owed to (a supplier isn't needed once it is paid in full)");
  }
}

// VAT on the expense is input VAT: with an active VAT registration it is claimed (Tax Receivable), otherwise it is
// simply part of what the expense cost.
export async function buildPostingLines(
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
    lines.push({ accountId: p.accountId, paymentModeId: p.modeId, creditAmount: round2(p.amount), description: `Expense ${expenseNumber}` });
  }

  return lines;
}

// A failed save must not leave an expense behind without its accounting.
export async function discardExpense(tenantId: string, expenseId: string, userId: string) {
  await reverseAllActiveEntriesForSource(tenantId, expenseId, userId, "Rolled back — expense could not be saved").catch(() => {});
  await db.delete(expenses).where(eq(expenses.id, expenseId));
}

export function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/**
 * Writes one expense: its number (EXP-####, unique per organization), the expense record and its ledger entry. Everything is
 * checked first, and a failure part-way leaves nothing behind. `takenNumbers` lets a batch share one list of used numbers
 * instead of reading them again for every expense.
 */
export async function createExpenseCore(
  ctx: { tenantId: string; userId: string },
  input: ExpenseInput,
  opts: { importId?: string; takenNumbers?: Set<string> } = {}
): Promise<{ expenseId: string; expenseNumber: string; warnings: string[] }> {
  const { tenantId, userId } = ctx;
  await validateExpenseInput(tenantId, input);
  const totals = computeExpenseTotals(input);
  assertSupplierIfUnpaid(input.vendorId, totals);
  await assertPeriodOpen(tenantId, input.expenseDate);
  const warnings = await evaluateAmountThresholdRules(tenantId, "expenses", totals.total);

  // The number is EXP-#### and unique per organization: pick the next free one, and if two people save at the
  // same instant the database's unique rule makes the loser pick again.
  let expense: typeof expenses.$inferSelect | undefined;
  let expenseNumber = "";
  for (let attempt = 0; attempt < 5 && !expense; attempt++) {
    const taken = opts.takenNumbers && attempt === 0 ? opts.takenNumbers : new Set((await db.select({ n: expenses.expenseNumber }).from(expenses).where(eq(expenses.tenantId, tenantId))).map((r) => r.n));
    expenseNumber = nextFreeInvoiceNumber(taken, (n) => `EXP-${String(n).padStart(4, "0")}`, taken.size + 1).number;
    try {
      [expense] = await db
        .insert(expenses)
        .values({
          tenantId,
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
          importId: opts.importId ?? null,
        })
        .returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      opts.takenNumbers?.add(expenseNumber);
    }
  }
  if (!expense) throw new Error("Could not allocate an expense number — please try again");
  opts.takenNumbers?.add(expenseNumber);

  try {
    const lines = await buildPostingLines(tenantId, expenseNumber, input.categoryAccountId, totals, input.payments);
    await postJournalEntry({
      tenantId,
      entryDate: input.expenseDate,
      sourceType: "expense",
      sourceId: expense.id,
      referenceNumber: expenseNumber,
      memo: `Expense ${expenseNumber}`,
      createdBy: userId,
      lines,
    });
  } catch (e) {
    await discardExpense(tenantId, expense.id, userId);
    opts.takenNumbers?.delete(expenseNumber);
    throw e;
  }
  return { expenseId: expense.id, expenseNumber, warnings };
}
