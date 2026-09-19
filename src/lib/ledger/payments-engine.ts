import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  payments,
  paymentAllocations,
  accounts,
  customers,
  vendors,
  employees,
  salesInvoices,
  purchaseBills,
  expenses,
  type paymentTypeEnum,
  type paymentDirectionEnum,
  type paymentPartyTypeEnum,
  type paymentMethodEnum,
  type paymentAllocationTargetEnum,
} from "@/db/schema";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "./post";
import { findControlAccount } from "./control-accounts";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import { getOrCreateExpensePayableAccount } from "./expense-accounts";
import {
  getOrCreateCustomerAdvanceSubAccountId,
  getOrCreateSupplierAdvanceSubAccountId,
  getOrCreateOwnerDrawingsAccount,
} from "./advance-accounts";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PaymentType = (typeof paymentTypeEnum.enumValues)[number];
export type PaymentDirection = (typeof paymentDirectionEnum.enumValues)[number];
export type PaymentPartyType = (typeof paymentPartyTypeEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type PaymentAllocationTarget = (typeof paymentAllocationTargetEnum.enumValues)[number];

export const MONEY_IN_TYPES: PaymentType[] = [
  "customer_payment",
  "customer_advance",
  "loan_received",
  "capital_introduced",
  "refund_received",
  "other_receipt",
];

export const MONEY_OUT_TYPES: PaymentType[] = [
  "supplier_payment",
  "expense_payment",
  "tax_payment",
  "loan_repayment",
  "supplier_advance",
  "owner_withdrawal",
  "cash_withdrawal",
  "bank_transfer",
  "other_payment",
];

// Types that show the invoice/bill/expense allocation section at all.
export const ALLOCATABLE_TYPES: PaymentType[] = ["customer_payment", "supplier_payment", "expense_payment"];

// Types that need a second ("to") account instead of/alongside a party.
export const TRANSFER_TYPES: PaymentType[] = ["bank_transfer", "cash_withdrawal"];

export type AllocationInput = { targetType: PaymentAllocationTarget; targetId: string; allocatedAmount: number };

export type CreatePaymentInput = {
  direction: PaymentDirection;
  paymentType: PaymentType;
  paymentDate: string;
  partyType: PaymentPartyType;
  customerId?: string | null;
  vendorId?: string | null;
  employeeId?: string | null;
  partyOtherName?: string | null;
  accountId: string;
  transferToAccountId?: string | null;
  categoryAccountId?: string | null;
  paymentMethod: PaymentMethod;
  chequeNumber?: string | null;
  chequeDate?: string | null;
  chequeBank?: string | null;
  referenceNumber?: string | null;
  amount: number;
  description?: string | null;
  notes?: string | null;
  attachmentUrl?: string | null;
  allocations?: AllocationInput[];
  origin?: "standalone" | "embedded";
  confirmDuplicate?: boolean;
};

export class DuplicatePaymentWarning extends Error {
  constructor() {
    super("A very similar payment was recorded recently. Confirm to post it anyway.");
  }
}

async function assertAccountActive(tenantId: string, accountId: string) {
  const [account] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId))).limit(1);
  if (!account) throw new Error("Selected account not found");
  if (!account.isActive) throw new Error(`Account "${account.name}" is not active`);
  return account;
}

async function checkDuplicate(tenantId: string, input: CreatePaymentInput) {
  const from = new Date(input.paymentDate + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - 2);
  const to = new Date(input.paymentDate + "T00:00:00Z");
  to.setUTCDate(to.getUTCDate() + 2);

  const candidates = await db
    .select({ id: payments.id, amount: payments.amount, customerId: payments.customerId, vendorId: payments.vendorId, referenceNumber: payments.referenceNumber })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.paymentType, input.paymentType),
        ne(payments.status, "voided"),
        gte(payments.paymentDate, from.toISOString().slice(0, 10)),
        lte(payments.paymentDate, to.toISOString().slice(0, 10))
      )
    );

  return candidates.some(
    (c) =>
      Math.abs(Number(c.amount) - input.amount) < 0.005 &&
      (input.customerId ? c.customerId === input.customerId : true) &&
      (input.vendorId ? c.vendorId === input.vendorId : true) &&
      (input.referenceNumber ? c.referenceNumber === input.referenceNumber : true)
  );
}

// Builds the Dr/Cr lines for one payment. This is the one place that decides
// accounting treatment per type — see spec sections 12/13/18-23.
async function buildLines(tenantId: string, input: CreatePaymentInput): Promise<PostLineInput[]> {
  const amount = round2(input.amount);
  const isIn = input.direction === "money_in";
  const label = input.description?.trim() || input.paymentType.replace(/_/g, " ");

  // Money-in: Dr the account. Money-out: Cr the account. (Transfers handle
  // both legs themselves below.)
  const primaryLine: PostLineInput = isIn
    ? { accountId: input.accountId, debitAmount: amount, description: label }
    : { accountId: input.accountId, creditAmount: amount, description: label };

  const allocations = input.allocations ?? [];
  const allocatedTotal = round2(allocations.reduce((s, a) => s + a.allocatedAmount, 0));
  const unallocated = round2(Math.max(amount - allocatedTotal, 0));

  switch (input.paymentType) {
    case "customer_payment": {
      const lines: PostLineInput[] = [primaryLine];
      for (const a of allocations) {
        const arId = await getOrCreateCustomerReceivableAccountId(tenantId, input.customerId!);
        lines.push({ accountId: arId, creditAmount: a.allocatedAmount, description: label });
      }
      if (unallocated > 0) {
        const [customer] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, input.customerId!)).limit(1);
        const advId = await getOrCreateCustomerAdvanceSubAccountId(tenantId, customer?.name ?? "Customer");
        lines.push({ accountId: advId, creditAmount: unallocated, description: `${label} (unallocated → advance)` });
      }
      return lines;
    }
    case "customer_advance": {
      const [customer] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, input.customerId!)).limit(1);
      const advId = await getOrCreateCustomerAdvanceSubAccountId(tenantId, customer?.name ?? "Customer");
      return [primaryLine, { accountId: advId, creditAmount: amount, description: label }];
    }
    case "loan_received": {
      const loans = await findControlAccount(tenantId, ["2200"], "Loans Payable");
      if (!loans) throw new Error("No Loans Payable account found — add one to the Chart of Accounts first");
      return [primaryLine, { accountId: loans.id, creditAmount: amount, description: label }];
    }
    case "capital_introduced": {
      const capital = await findControlAccount(tenantId, ["3000"], "Owner's Capital");
      if (!capital) throw new Error("No Owner's Capital account found — add one to the Chart of Accounts first");
      return [primaryLine, { accountId: capital.id, creditAmount: amount, description: label }];
    }
    case "refund_received": {
      const lines: PostLineInput[] = [primaryLine];
      let remaining = amount;
      if (input.vendorId) {
        const [vendor] = await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
        const advId = await getOrCreateSupplierAdvanceSubAccountId(tenantId, vendor?.name ?? "Supplier");
        lines.push({ accountId: advId, creditAmount: remaining, description: label });
        remaining = 0;
      } else if (input.categoryAccountId) {
        lines.push({ accountId: input.categoryAccountId, creditAmount: remaining, description: label });
        remaining = 0;
      } else {
        const otherIncome = await findControlAccount(tenantId, ["4100"], "Other Income");
        if (!otherIncome) throw new Error("No Other Income account found — add one to the Chart of Accounts first");
        lines.push({ accountId: otherIncome.id, creditAmount: remaining, description: label });
        remaining = 0;
      }
      return lines;
    }
    case "other_receipt": {
      const categoryId = input.categoryAccountId ?? (await findControlAccount(tenantId, ["4100"], "Other Income"))?.id;
      if (!categoryId) throw new Error("Select a classification account for this receipt");
      return [primaryLine, { accountId: categoryId, creditAmount: amount, description: label }];
    }
    case "supplier_payment": {
      const lines: PostLineInput[] = [];
      for (const a of allocations) {
        const apId = await getOrCreateSupplierPayableAccountId(tenantId, input.vendorId!);
        lines.push({ accountId: apId, debitAmount: a.allocatedAmount, description: label });
      }
      if (unallocated > 0) {
        const [vendor] = await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, input.vendorId!)).limit(1);
        const advId = await getOrCreateSupplierAdvanceSubAccountId(tenantId, vendor?.name ?? "Supplier");
        lines.push({ accountId: advId, debitAmount: unallocated, description: `${label} (unallocated → advance)` });
      }
      lines.push(primaryLine);
      return lines;
    }
    case "expense_payment": {
      const expensePayable = await getOrCreateExpensePayableAccount(tenantId);
      return [{ accountId: expensePayable.id, debitAmount: amount, description: label }, primaryLine];
    }
    case "tax_payment": {
      const taxAccountId = input.categoryAccountId ?? (await findControlAccount(tenantId, ["2100"], "Tax Payable"))?.id;
      if (!taxAccountId) throw new Error("Select which tax liability account this payment settles");
      return [{ accountId: taxAccountId, debitAmount: amount, description: label }, primaryLine];
    }
    case "loan_repayment": {
      const loans = await findControlAccount(tenantId, ["2200"], "Loans Payable");
      if (!loans) throw new Error("No Loans Payable account found — add one to the Chart of Accounts first");
      return [{ accountId: loans.id, debitAmount: amount, description: label }, primaryLine];
    }
    case "supplier_advance": {
      const [vendor] = await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, input.vendorId!)).limit(1);
      const advId = await getOrCreateSupplierAdvanceSubAccountId(tenantId, vendor?.name ?? "Supplier");
      return [{ accountId: advId, debitAmount: amount, description: label }, primaryLine];
    }
    case "owner_withdrawal": {
      const drawings = await getOrCreateOwnerDrawingsAccount(tenantId);
      return [{ accountId: drawings.id, debitAmount: amount, description: label }, primaryLine];
    }
    case "cash_withdrawal": {
      if (!input.transferToAccountId) throw new Error("Select the cash account the withdrawal is deposited into");
      return [
        { accountId: input.transferToAccountId, debitAmount: amount, description: label },
        primaryLine,
      ];
    }
    case "bank_transfer": {
      if (!input.transferToAccountId) throw new Error("Select the destination account for the transfer");
      return [
        { accountId: input.transferToAccountId, debitAmount: amount, description: label },
        primaryLine,
      ];
    }
    case "other_payment": {
      const categoryId = input.categoryAccountId ?? (await findControlAccount(tenantId, ["5900"], "Miscellaneous Expense"))?.id;
      if (!categoryId) throw new Error("Select a classification account for this payment");
      return [{ accountId: categoryId, debitAmount: amount, description: label }, primaryLine];
    }
    default:
      throw new Error(`Unhandled payment type: ${input.paymentType}`);
  }
}

function validateInput(input: CreatePaymentInput) {
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero.");
  if (!input.paymentDate) throw new Error("Payment date is required.");
  if (!input.accountId) throw new Error("Select an account.");

  const needsCustomer = input.paymentType === "customer_payment" || input.paymentType === "customer_advance";
  const needsVendor = input.paymentType === "supplier_payment" || input.paymentType === "supplier_advance";
  if (needsCustomer && !input.customerId) throw new Error("Select a customer.");
  if (needsVendor && !input.vendorId) throw new Error("Select a supplier.");

  if (TRANSFER_TYPES.includes(input.paymentType) && !input.transferToAccountId) {
    throw new Error("Select the destination account.");
  }
  if (TRANSFER_TYPES.includes(input.paymentType) && input.transferToAccountId === input.accountId) {
    throw new Error("From and To accounts must be different.");
  }

  if (input.paymentMethod === "cheque" && !input.chequeNumber?.trim()) {
    throw new Error("Cheque number is required for a cheque payment.");
  }

  const allocations = input.allocations ?? [];
  const allocatedTotal = round2(allocations.reduce((s, a) => s + a.allocatedAmount, 0));
  if (allocatedTotal > round2(input.amount) + 0.005) {
    throw new Error("Allocated amount cannot exceed the payment amount.");
  }
  if (input.paymentType === "expense_payment") {
    if (allocations.length !== 1) throw new Error("Select exactly one expense to settle.");
    if (Math.abs(allocations[0].allocatedAmount - input.amount) > 0.005) {
      throw new Error("The full payment amount must be allocated to the selected expense.");
    }
  }
}

async function applyAllocationToTarget(tenantId: string, allocation: AllocationInput) {
  if (allocation.targetType === "sales_invoice") {
    const [invoice] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.id, allocation.targetId), eq(salesInvoices.tenantId, tenantId))).limit(1);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "void") throw new Error("Cannot allocate against a cancelled invoice");
    const outstanding = round2(Number(invoice.total) - Number(invoice.amountPaid));
    if (allocation.allocatedAmount > outstanding + 0.005) throw new Error(`Allocation exceeds invoice ${invoice.invoiceNumber}'s outstanding balance`);
    const newPaid = round2(Number(invoice.amountPaid) + allocation.allocatedAmount);
    const status = newPaid >= Number(invoice.total) - 0.005 ? "paid" : "partially_paid";
    await db.update(salesInvoices).set({ amountPaid: newPaid.toFixed(2), status }).where(eq(salesInvoices.id, invoice.id));
  } else if (allocation.targetType === "purchase_bill") {
    const [bill] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.id, allocation.targetId), eq(purchaseBills.tenantId, tenantId))).limit(1);
    if (!bill) throw new Error("Bill not found");
    if (bill.status === "void") throw new Error("Cannot allocate against a cancelled bill");
    const outstanding = round2(Number(bill.total) - Number(bill.amountPaid));
    if (allocation.allocatedAmount > outstanding + 0.005) throw new Error(`Allocation exceeds bill ${bill.billNumber}'s outstanding balance`);
    const newPaid = round2(Number(bill.amountPaid) + allocation.allocatedAmount);
    const status = newPaid >= Number(bill.total) - 0.005 ? "paid" : "partially_paid";
    await db.update(purchaseBills).set({ amountPaid: newPaid.toFixed(2), status }).where(eq(purchaseBills.id, bill.id));
  } else if (allocation.targetType === "expense") {
    const [expense] = await db.select().from(expenses).where(and(eq(expenses.id, allocation.targetId), eq(expenses.tenantId, tenantId))).limit(1);
    if (!expense) throw new Error("Expense not found");
    if (expense.status === "void") throw new Error("Cannot allocate against a void expense");
    const outstanding = round2(Number(expense.amountPayable) - Number(expense.amountPaid));
    if (allocation.allocatedAmount > outstanding + 0.005) throw new Error(`Allocation exceeds expense ${expense.expenseNumber}'s outstanding balance`);
    const newPaid = round2(Number(expense.amountPaid) + allocation.allocatedAmount);
    const status = newPaid >= Number(expense.amountPayable) - 0.005 ? "paid" : "partially_paid";
    await db.update(expenses).set({ amountPaid: newPaid.toFixed(2), status }).where(eq(expenses.id, expense.id));
  }
}

async function revertAllocationOnTarget(tenantId: string, allocation: { targetType: PaymentAllocationTarget; targetId: string; allocatedAmount: string }) {
  const amount = Number(allocation.allocatedAmount);
  if (allocation.targetType === "sales_invoice") {
    const [invoice] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.id, allocation.targetId), eq(salesInvoices.tenantId, tenantId))).limit(1);
    if (!invoice) return;
    const newPaid = round2(Math.max(Number(invoice.amountPaid) - amount, 0));
    const status = newPaid <= 0 ? "sent" : newPaid >= Number(invoice.total) - 0.005 ? "paid" : "partially_paid";
    await db.update(salesInvoices).set({ amountPaid: newPaid.toFixed(2), status }).where(eq(salesInvoices.id, invoice.id));
  } else if (allocation.targetType === "purchase_bill") {
    const [bill] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.id, allocation.targetId), eq(purchaseBills.tenantId, tenantId))).limit(1);
    if (!bill) return;
    const newPaid = round2(Math.max(Number(bill.amountPaid) - amount, 0));
    const status = newPaid <= 0 ? "open" : newPaid >= Number(bill.total) - 0.005 ? "paid" : "partially_paid";
    await db.update(purchaseBills).set({ amountPaid: newPaid.toFixed(2), status }).where(eq(purchaseBills.id, bill.id));
  } else if (allocation.targetType === "expense") {
    const [expense] = await db.select().from(expenses).where(and(eq(expenses.id, allocation.targetId), eq(expenses.tenantId, tenantId))).limit(1);
    if (!expense) return;
    const newPaid = round2(Math.max(Number(expense.amountPaid) - amount, 0));
    const status = newPaid <= 0 ? "unpaid" : newPaid >= Number(expense.amountPayable) - 0.005 ? "paid" : "partially_paid";
    await db.update(expenses).set({ amountPaid: newPaid.toFixed(2), status }).where(eq(expenses.id, expense.id));
  }
}

export type CreatePaymentResult = { paymentId: string; paymentNumber: string } | { duplicateWarning: true };

/**
 * The single entry point for recording a settlement in the unified Payment
 * module — validates, decides the correct Dr/Cr treatment for the chosen
 * type, posts one balanced journal entry via postJournalEntry, records the
 * payment + its allocations, and updates every allocated invoice/bill/
 * expense's paid amount and status. Never duplicates Purchase/Expense/
 * Payroll recording — it only ever settles an amount already recorded
 * there, or books a genuinely new money movement (advance, loan, capital,
 * transfer, tax, drawings, other).
 */
export async function createPayment(
  tenantId: string,
  userId: string,
  paymentNumber: string,
  input: CreatePaymentInput
): Promise<CreatePaymentResult> {
  validateInput(input);
  await assertAccountActive(tenantId, input.accountId);
  if (input.transferToAccountId) await assertAccountActive(tenantId, input.transferToAccountId);

  if (!input.confirmDuplicate && (await checkDuplicate(tenantId, input))) {
    return { duplicateWarning: true };
  }

  const lines = await buildLines(tenantId, input);

  const entry = await postJournalEntry({
    tenantId,
    entryDate: input.paymentDate,
    sourceType: input.direction === "money_in" ? "receipt" : "payment",
    referenceNumber: paymentNumber,
    memo: `${paymentNumber} — ${input.paymentType.replace(/_/g, " ")}`,
    createdBy: userId,
    lines,
  });

  const [row] = await db
    .insert(payments)
    .values({
      tenantId,
      paymentNumber,
      direction: input.direction,
      paymentType: input.paymentType,
      paymentDate: input.paymentDate,
      partyType: input.partyType,
      customerId: input.customerId || null,
      vendorId: input.vendorId || null,
      employeeId: input.employeeId || null,
      partyOtherName: input.partyOtherName || null,
      accountId: input.accountId,
      transferToAccountId: input.transferToAccountId || null,
      categoryAccountId: input.categoryAccountId || null,
      paymentMethod: input.paymentMethod,
      chequeNumber: input.chequeNumber || null,
      chequeDate: input.chequeDate || null,
      chequeBank: input.chequeBank || null,
      referenceNumber: input.referenceNumber || null,
      amount: input.amount.toFixed(2),
      description: input.description || null,
      notes: input.notes || null,
      attachmentUrl: input.attachmentUrl || null,
      status: "posted",
      origin: input.origin ?? "standalone",
      journalEntryId: entry.id,
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    })
    .returning();

  const allocations = input.allocations ?? [];
  if (allocations.length > 0) {
    await db.insert(paymentAllocations).values(
      allocations.map((a) => ({ paymentId: row.id, targetType: a.targetType, targetId: a.targetId, allocatedAmount: a.allocatedAmount.toFixed(2) }))
    );
    for (const a of allocations) {
      await applyAllocationToTarget(tenantId, a);
    }
  }

  return { paymentId: row.id, paymentNumber };
}

/**
 * Voids a standalone payment: reverses its journal entry and rolls back
 * every allocation it made on the invoices/bills/expenses it touched.
 * Embedded payments (recorded by Sales/Purchases at invoice/bill creation)
 * are never voided here — void or edit the source invoice/bill instead.
 */
export async function voidPayment(tenantId: string, paymentId: string, userId: string, reason: string) {
  const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId))).limit(1);
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "voided") throw new Error("Payment is already voided");
  if (payment.origin === "embedded") {
    throw new Error("This payment was recorded automatically by Sales/Purchases — void or edit the source invoice/bill instead.");
  }

  const allocations = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  for (const a of allocations) {
    await revertAllocationOnTarget(tenantId, a);
  }

  if (payment.journalEntryId) {
    await reverseJournalEntry(tenantId, payment.journalEntryId, userId, `Void of payment ${payment.paymentNumber}: ${reason}`);
  }

  await db
    .update(payments)
    .set({ status: "voided", voidReason: reason, voidedBy: userId, voidedAt: new Date() })
    .where(eq(payments.id, paymentId));
}
