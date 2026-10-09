import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  payments,
  paymentAllocations,
  accounts,
  customers,
  vendors,
  employees,
  staffAdvances,
  staffAdvanceRecoveries,
  salesInvoices,
  purchaseBills,
  expenses,
  complianceObligations,
  journalLines,
  bankReconciliationMatchJournalLines,
  type paymentTypeEnum,
  type paymentDirectionEnum,
  type paymentPartyTypeEnum,
  type paymentMethodEnum,
  type paymentAllocationTargetEnum,
} from "@/db/schema";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "./post";
import { logAuditEvent } from "@/lib/audit";
import { findControlAccount } from "./control-accounts";
import { assertCashBankAccounts } from "./account-guards";
import { resolvePaymentMode } from "@/lib/payment-modes";
import { getCustomerBalances } from "./customer-balances";
import { getSupplierBalances } from "./supplier-balances";
import { getEmployeePayableBalance } from "@/lib/payroll/accrual";
import { assertMonthOpenForAdvance } from "@/lib/payroll/staff-advances";
import { getOrCreateEmployeeAdvanceAccountId } from "./advance-accounts";
import { isoFromYmd, type CalendarSystem } from "@/lib/calendar";
import { createEmployeePayableAccount } from "./payroll-accounts";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { todayIso } from "@/lib/calendar";
import { ensureTaxPayableAccount } from "@/lib/compliance/tax-accounts";
import { obligationAmounts, syncObligationFromPayments } from "@/lib/compliance/tax-amounts";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import { getOrCreateExpensePayableAccount } from "./expense-accounts";
import {
  getOrCreateCustomerAdvanceAccountId,
  getOrCreateSupplierAdvanceAccountId,
  getCustomerAdvanceBalance,
  getSupplierAdvanceBalance,
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
  "customer_refund",
  "salary_payment",
  "staff_advance",
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
  /** The payment mode picked (Cash, Cheque, Fonepay, ...). When given it decides the payment method. */
  paymentModeId?: string | null;
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
  /** Staff advance only: the payroll month it is taken against, in the calendar it was chosen in. */
  advanceMonth?: { calendar: CalendarSystem; month: number; year: number } | null;
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
    .select({ id: payments.id, amount: payments.amount, customerId: payments.customerId, vendorId: payments.vendorId, employeeId: payments.employeeId, referenceNumber: payments.referenceNumber })
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
      (input.employeeId ? c.employeeId === input.employeeId : true) &&
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
    ? { accountId: input.accountId, paymentModeId: input.paymentModeId, debitAmount: amount, description: label }
    : { accountId: input.accountId, paymentModeId: input.paymentModeId, creditAmount: amount, description: label };

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
        const advId = await getOrCreateCustomerAdvanceAccountId(tenantId, input.customerId!);
        lines.push({ accountId: advId, creditAmount: unallocated, description: `${label} (unallocated → advance)` });
      }
      return lines;
    }
    case "customer_advance": {
      const advId = await getOrCreateCustomerAdvanceAccountId(tenantId, input.customerId!);
      return [primaryLine, { accountId: advId, creditAmount: amount, description: label }];
    }
    case "loan_received": {
      const loans = await findControlAccount(tenantId, ["2200"], "Loans Payable");
      if (!loans) throw new Error("No Loans Payable account found — add one to the Chart of Accounts first");
      return [primaryLine, { accountId: loans.id, creditAmount: amount, description: label }];
    }
    case "capital_introduced": {
      // Capital paid in by a specific shareholder is credited to THEIR capital sub-account
      // (chosen as the classification account); otherwise it goes to the capital group.
      if (input.categoryAccountId) {
        const [target] = await db.select().from(accounts).where(and(eq(accounts.id, input.categoryAccountId), eq(accounts.tenantId, tenantId))).limit(1);
        if (!target || target.category !== "equity") throw new Error("Capital must be credited to an equity account");
        return [primaryLine, { accountId: target.id, creditAmount: amount, description: label }];
      }
      const capital = await findControlAccount(tenantId, ["3000"], "Owner's Capital");
      if (!capital) throw new Error("No Owner's Capital account found — add one to the Chart of Accounts first");
      return [primaryLine, { accountId: capital.id, creditAmount: amount, description: label }];
    }
    case "refund_received": {
      const lines: PostLineInput[] = [primaryLine];
      let remaining = amount;
      if (input.vendorId) {
        // A refund after a purchase return settles what the supplier owes us on their own (payable) account first;
        // anything beyond that reduces an advance we paid them.
        const balance = (await getSupplierBalances(tenantId))[input.vendorId] ?? 0; // negative = the supplier owes us
        const owedToUs = round2(Math.max(-balance, 0));
        const toPayable = round2(Math.min(remaining, owedToUs));
        if (toPayable > 0) {
          const apId = await getOrCreateSupplierPayableAccountId(tenantId, input.vendorId);
          lines.push({ accountId: apId, creditAmount: toPayable, description: label });
          remaining = round2(remaining - toPayable);
        }
        if (remaining > 0) {
          const advId = await getOrCreateSupplierAdvanceAccountId(tenantId, input.vendorId!);
          lines.push({ accountId: advId, creditAmount: remaining, description: label });
          remaining = 0;
        }
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
        const advId = await getOrCreateSupplierAdvanceAccountId(tenantId, input.vendorId!);
        lines.push({ accountId: advId, debitAmount: unallocated, description: `${label} (unallocated → advance)` });
      }
      lines.push(primaryLine);
      return lines;
    }
    case "customer_refund": {
      // Money paid back to a customer settles, first, the credit we owe them on their own (receivable) account — for
      // example after a sales return — and then any advance they have paid us.
      const owedOnAccount = round2(Math.max(-((await getCustomerBalances(tenantId))[input.customerId!] ?? 0), 0));
      const fromAccount = round2(Math.min(amount, owedOnAccount));
      const fromAdvance = round2(amount - fromAccount);
      const lines: PostLineInput[] = [];
      if (fromAccount > 0) {
        const arId = await getOrCreateCustomerReceivableAccountId(tenantId, input.customerId!);
        lines.push({ accountId: arId, debitAmount: fromAccount, description: label });
      }
      if (fromAdvance > 0) {
        const advId = await getOrCreateCustomerAdvanceAccountId(tenantId, input.customerId!);
        lines.push({ accountId: advId, debitAmount: fromAdvance, description: `${label} (advance refunded)` });
      }
      lines.push(primaryLine);
      return lines;
    }
    case "salary_payment": {
      // Pay-out of what an employee is owed: settles their own Salary Payable account.
      const [emp] = await db.select({ id: employees.id, fullName: employees.fullName, payableAccountId: employees.payableAccountId }).from(employees).where(and(eq(employees.id, input.employeeId!), eq(employees.tenantId, tenantId))).limit(1);
      if (!emp) throw new Error("Employee not found");
      const payableId = emp.payableAccountId ?? (await createEmployeePayableAccount(tenantId, emp.fullName)).id;
      if (!emp.payableAccountId) await db.update(employees).set({ payableAccountId: payableId }).where(eq(employees.id, emp.id));
      return [{ accountId: payableId, debitAmount: amount, description: label }, primaryLine];
    }
    case "staff_advance": {
      // Money handed to an employee ahead of salary: it sits on their own Staff Advance account until payroll recovers it.
      const advanceId = await getOrCreateEmployeeAdvanceAccountId(tenantId, input.employeeId!);
      return [{ accountId: advanceId, debitAmount: amount, description: label }, primaryLine];
    }
    case "expense_payment": {
      const expensePayable = await getOrCreateExpensePayableAccount(tenantId);
      return [{ accountId: expensePayable.id, debitAmount: amount, description: label }, primaryLine];
    }
    case "tax_payment": {
      const lines: PostLineInput[] = [];
      // Payments linked to compliance items settle each item's own tax payable account
      // (VAT, TDS, ...); anything not linked goes to the chosen (or default) tax account.
      const linked = allocations.filter((a) => a.targetType === "tax_obligation");
      if (linked.length > 0) {
        const obs = await db.select().from(complianceObligations).where(and(eq(complianceObligations.tenantId, tenantId), inArray(complianceObligations.id, linked.map((a) => a.targetId))));
        const typeById = new Map(obs.map((o) => [o.id, o.taxTypeKey]));
        const perAccount = new Map<string, number>();
        for (const a of linked) {
          const taxTypeKey = typeById.get(a.targetId);
          const account = taxTypeKey ? await ensureTaxPayableAccount(tenantId, taxTypeKey) : null;
          if (!account) throw new Error("This compliance item's tax type has no payable account configured");
          perAccount.set(account.id, round2((perAccount.get(account.id) ?? 0) + a.allocatedAmount));
        }
        for (const [accountId, value] of perAccount) lines.push({ accountId, debitAmount: value, description: label });
      }
      const rest = round2(amount - round2(linked.reduce((s, a) => s + a.allocatedAmount, 0)));
      if (rest > 0) {
        const taxAccountId = input.categoryAccountId ?? (await findControlAccount(tenantId, ["2100"], "Tax Payable"))?.id;
        if (!taxAccountId) throw new Error("Select which tax liability account this payment settles");
        lines.push({ accountId: taxAccountId, debitAmount: rest, description: label });
      }
      lines.push(primaryLine);
      return lines;
    }
    case "loan_repayment": {
      const loans = await findControlAccount(tenantId, ["2200"], "Loans Payable");
      if (!loans) throw new Error("No Loans Payable account found — add one to the Chart of Accounts first");
      return [{ accountId: loans.id, debitAmount: amount, description: label }, primaryLine];
    }
    case "supplier_advance": {
      const advId = await getOrCreateSupplierAdvanceAccountId(tenantId, input.vendorId!);
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

// Checked before anything is posted: a payment may only settle tax compliance items that
// belong to this organization and are still owed, and never more than their balance.
// `credit` is what the payment being edited already settles on each item (by id): free again for the new version.
async function validateTaxAllocations(tenantId: string, input: CreatePaymentInput, credit: Map<string, number> = new Map()) {
  const linked = (input.allocations ?? []).filter((a) => a.targetType === "tax_obligation");
  if (linked.length === 0) return;
  if (input.paymentType !== "tax_payment") throw new Error("Only a tax payment can settle a compliance item.");

  const wanted = new Map<string, number>();
  for (const a of linked) wanted.set(a.targetId, round2((wanted.get(a.targetId) ?? 0) + a.allocatedAmount));

  const obs = await db.select().from(complianceObligations).where(and(eq(complianceObligations.tenantId, tenantId), inArray(complianceObligations.id, [...wanted.keys()])));
  const amounts = await obligationAmounts(tenantId, obs);
  for (const [id, value] of wanted) {
    const ob = obs.find((o) => o.id === id);
    if (!ob) throw new Error("Compliance item not found");
    if (ob.categoryKey !== "tax") throw new Error(`"${ob.name}" is not a tax item`);
    if (ob.status === "not_applicable") throw new Error(`"${ob.name}" is marked not applicable`);
    const balance = round2(amounts.get(id)!.balance + (credit.get(id) ?? 0));
    if (value > balance + 0.005) throw new Error(`The allocation exceeds the balance of ${ob.name} (${ob.periodLabel}): ${balance.toFixed(2)}`);
  }
}

function validateInput(input: CreatePaymentInput) {
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero.");
  if (!input.paymentDate) throw new Error("Payment date is required.");
  if (!input.accountId) throw new Error("Select an account.");

  const needsCustomer = input.paymentType === "customer_payment" || input.paymentType === "customer_advance" || input.paymentType === "customer_refund";
  const needsVendor = input.paymentType === "supplier_payment" || input.paymentType === "supplier_advance";
  if (needsCustomer && !input.customerId) throw new Error("Select a customer.");
  if (needsVendor && !input.vendorId) throw new Error("Select a supplier.");
  if ((input.paymentType === "salary_payment" || input.paymentType === "staff_advance") && !input.employeeId) throw new Error("Select an employee.");
  if (input.paymentType === "staff_advance" && !input.advanceMonth) throw new Error("Select the month this advance is against.");

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
  if (allocation.targetType === "tax_obligation") {
    await syncObligationFromPayments(tenantId, allocation.targetId);
  } else if (allocation.targetType === "sales_invoice") {
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

async function revertAllocationOnTarget(tenantId: string, allocation: { targetType: PaymentAllocationTarget; targetId: string; allocatedAmount: string; paymentId?: string }) {
  const amount = Number(allocation.allocatedAmount);
  if (allocation.targetType === "tax_obligation") {
    // The payment is not marked voided yet, so leave it out of the paid total explicitly.
    await syncObligationFromPayments(tenantId, allocation.targetId, { excludePaymentId: allocation.paymentId });
  } else if (allocation.targetType === "sales_invoice") {
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

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

// The parties and accounts a payment names must be this organization's, and the money must move through its
// Cash/Bank accounts — ids arrive from the browser, so this is checked here rather than trusted.
async function validateOwnership(tenantId: string, input: CreatePaymentInput) {
  if (input.customerId) {
    const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId))).limit(1);
    if (!c) throw new Error("Customer not found");
  }
  if (input.vendorId) {
    const [v] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
    if (!v) throw new Error("Supplier not found");
  }
  if (input.employeeId) {
    const [e] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, tenantId))).limit(1);
    if (!e) throw new Error("Employee not found");
  }
  await assertCashBankAccounts(tenantId, [input.accountId, ...(input.transferToAccountId ? [input.transferToAccountId] : [])]);
  if (input.categoryAccountId) {
    const [a] = await db.select({ code: accounts.code }).from(accounts).where(and(eq(accounts.id, input.categoryAccountId), eq(accounts.tenantId, tenantId))).limit(1);
    if (!a) throw new Error("Classification account not found");
    const partyControl = ["1100", "2000"].some((c) => a.code === c || a.code.startsWith(c + "."));
    if (partyControl) throw new Error("Choose a classification account — customer and supplier accounts are settled through their own payment types");
  }
}

const EXPECTED_TARGET: Partial<Record<PaymentType, PaymentAllocationTarget>> = {
  customer_payment: "sales_invoice",
  supplier_payment: "purchase_bill",
  expense_payment: "expense",
  tax_payment: "tax_obligation",
};

// Checked before anything is posted: every allocation must point at a live document of the right kind that belongs
// to the party being paid, and no document may be allocated more than it still owes.
async function validateAllocations(tenantId: string, input: CreatePaymentInput, credit: Map<string, number> = new Map()) {
  const allocations = input.allocations ?? [];
  if (allocations.length === 0) return;
  const expected = EXPECTED_TARGET[input.paymentType];
  for (const a of allocations) {
    if (!(a.allocatedAmount > 0)) throw new Error("Each allocated amount must be greater than zero");
    if (a.targetType !== expected) throw new Error("This payment type can't settle that kind of document");
  }
  if (expected === "tax_obligation") return; // checked by validateTaxAllocations

  const wanted = new Map<string, number>();
  for (const a of allocations) wanted.set(a.targetId, round2((wanted.get(a.targetId) ?? 0) + a.allocatedAmount));
  const ids = [...wanted.keys()];

  if (expected === "sales_invoice") {
    const rows = await db.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.id, ids)));
    for (const [id, value] of wanted) {
      const inv = rows.find((r) => r.id === id);
      if (!inv) throw new Error("Invoice not found");
      if (inv.status === "void") throw new Error(`Invoice ${inv.invoiceNumber} is cancelled`);
      if (inv.customerId !== input.customerId) throw new Error(`Invoice ${inv.invoiceNumber} belongs to a different customer`);
      if (value > round2(Number(inv.total) - Number(inv.amountPaid) + (credit.get(id) ?? 0)) + 0.005) throw new Error(`The allocation exceeds invoice ${inv.invoiceNumber}'s outstanding balance`);
    }
  } else if (expected === "purchase_bill") {
    const rows = await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, tenantId), inArray(purchaseBills.id, ids)));
    for (const [id, value] of wanted) {
      const bill = rows.find((r) => r.id === id);
      if (!bill) throw new Error("Bill not found");
      if (bill.status === "void") throw new Error(`Bill ${bill.billNumber} is cancelled`);
      if (bill.vendorId !== input.vendorId) throw new Error(`Bill ${bill.billNumber} belongs to a different supplier`);
      if (value > round2(Number(bill.total) - Number(bill.amountPaid) + (credit.get(id) ?? 0)) + 0.005) throw new Error(`The allocation exceeds bill ${bill.billNumber}'s outstanding balance`);
    }
  } else if (expected === "expense") {
    const rows = await db.select().from(expenses).where(and(eq(expenses.tenantId, tenantId), inArray(expenses.id, ids)));
    for (const [id, value] of wanted) {
      const ex = rows.find((r) => r.id === id);
      if (!ex) throw new Error("Expense not found");
      if (ex.status === "void") throw new Error(`Expense ${ex.expenseNumber} is void`);
      if (input.vendorId && ex.vendorId && ex.vendorId !== input.vendorId) throw new Error(`Expense ${ex.expenseNumber} belongs to a different supplier`);
      if (value > round2(Number(ex.amountPayable) - Number(ex.amountPaid) + (credit.get(id) ?? 0)) + 0.005) throw new Error(`The allocation exceeds expense ${ex.expenseNumber}'s outstanding balance`);
    }
  }
}

// Paying a customer back can't be more than we owe them: the credit on their account (for example after a sales
// return) plus any advance they have paid us.
// `ownAmount`: when a refund is being edited, what it already paid back counts as still available.
async function validateRefund(tenantId: string, input: CreatePaymentInput, ownAmount = 0) {
  if (input.paymentType !== "customer_refund") return;
  const balance = (await getCustomerBalances(tenantId))[input.customerId!] ?? 0; // negative = we owe the customer
  const credit = round2(Math.max(-balance, 0));
  const advance = round2(Math.max(await getCustomerAdvanceBalance(tenantId, input.customerId!), 0));
  const refundable = round2(credit + advance + ownAmount);
  if (round2(input.amount) > refundable + 0.005) {
    throw new Error(
      refundable > 0
        ? `This customer is owed ${refundable.toFixed(2)} (credit ${credit.toFixed(2)} + advance ${advance.toFixed(2)}), so a refund can't be more than that`
        : "This customer isn't owed anything — there is no credit or advance to refund"
    );
  }
}

// A salary payment settles what the employee is owed (their Salary Payable balance), so it can't be more than that.
async function validateSalaryPayment(tenantId: string, input: CreatePaymentInput, ownAmount = 0) {
  if (input.paymentType !== "salary_payment") return;
  const owed = round2(Math.max(await getEmployeePayableBalance(tenantId, input.employeeId!), 0) + ownAmount);
  if (round2(input.amount) > owed + 0.005) {
    throw new Error(
      owed > 0
        ? `This employee is owed ${owed.toFixed(2)}, so a salary payment can't be more than that`
        : "This employee isn't owed any salary — finalize their payroll run first (or there is nothing left to pay)"
    );
  }
}

// A staff advance goes to someone who is employed on the day it is paid, against a payroll month that is still open.
async function validateStaffAdvance(tenantId: string, input: CreatePaymentInput) {
  if (input.paymentType !== "staff_advance") return;
  const m = input.advanceMonth!;
  const forPeriodStart = Number.isInteger(m.month) && Number.isInteger(m.year) ? isoFromYmd(m.calendar, { year: m.year, month: m.month, day: 1 }) : null;
  if (!forPeriodStart) throw new Error("Choose a valid month for this advance");
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId!), eq(employees.tenantId, tenantId))).limit(1);
  if (!emp) throw new Error("Employee not found");
  if (emp.employmentStatus === "inactive" || emp.employmentStatus === "terminated") throw new Error(`${emp.fullName} is not an active employee`);
  if (emp.joiningDate > input.paymentDate) throw new Error(`${emp.fullName} hadn't joined by that date`);
  if (emp.leavingDate && emp.leavingDate < input.paymentDate) throw new Error(`${emp.fullName} had already left by that date`);
  await assertMonthOpenForAdvance(tenantId, m.calendar, m.month, m.year, forPeriodStart);
}

// The money a payment put into an advance account can't be taken away (by voiding the payment) once it has been
// applied to a document or refunded.
async function assertAdvanceStillThere(tenantId: string, payment: typeof payments.$inferSelect, allocatedTotal: number) {
  const amount = Number(payment.amount);
  const unallocated = round2(Math.max(amount - allocatedTotal, 0));
  let toAdvance = 0;
  let side: "customer" | "supplier" | null = null;
  if (payment.paymentType === "customer_advance") [side, toAdvance] = ["customer", amount];
  else if (payment.paymentType === "customer_payment") [side, toAdvance] = ["customer", unallocated];
  else if (payment.paymentType === "supplier_advance") [side, toAdvance] = ["supplier", amount];
  else if (payment.paymentType === "supplier_payment") [side, toAdvance] = ["supplier", unallocated];
  const partyId = side === "customer" ? payment.customerId : payment.vendorId;
  if (!side || !partyId || toAdvance <= 0.005) return;
  const balance = side === "customer" ? await getCustomerAdvanceBalance(tenantId, partyId) : await getSupplierAdvanceBalance(tenantId, partyId);
  if (balance + 0.005 < toAdvance) throw new Error("The advance from this payment has already been applied or refunded — take that back before voiding the payment");
}

// Undoes a payment that was only partly recorded: allocations already applied, the journal entry, and the row.
async function rollbackCreated(tenantId: string, userId: string, paymentId: string, entryId: string | null, applied: AllocationInput[]) {
  for (const a of applied) {
    await revertAllocationOnTarget(tenantId, { targetType: a.targetType, targetId: a.targetId, allocatedAmount: a.allocatedAmount.toFixed(2), paymentId }).catch(() => {});
  }
  if (entryId) await reverseJournalEntry(tenantId, entryId, userId, "Rolled back — payment could not be recorded").catch(() => {});
  await db.delete(payments).where(eq(payments.id, paymentId));
}

/**
 * The single entry point for recording a settlement in the unified Payment module. It checks everything BEFORE
 * anything is posted (parties, accounts, allocations, period), reserves the payment number, posts one balanced
 * journal entry, records the allocations and updates each invoice/bill/expense — and if any step fails it takes the
 * earlier steps back, so a failed payment leaves nothing behind.
 */
export async function createPayment(
  tenantId: string,
  userId: string,
  paymentNumber: string,
  input: CreatePaymentInput
): Promise<CreatePaymentResult> {
  validateInput(input);
  await validateOwnership(tenantId, input);
  await validateTaxAllocations(tenantId, input);
  await validateAllocations(tenantId, input);
  await validateRefund(tenantId, input);
  await validateSalaryPayment(tenantId, input);
  await validateStaffAdvance(tenantId, input);
  await assertAccountActive(tenantId, input.accountId);
  const mode = await resolvePaymentMode(tenantId, input.paymentModeId, input.accountId);
  if (input.transferToAccountId) await assertAccountActive(tenantId, input.transferToAccountId);

  if (!input.confirmDuplicate && (await checkDuplicate(tenantId, input))) {
    return { duplicateWarning: true };
  }
  await assertPeriodOpen(tenantId, input.paymentDate);
  const lines = await buildLines(tenantId, input);

  // Reserve the row (and with it the number) first; two payments saved at the same instant can't share a number.
  let row: typeof payments.$inferSelect | undefined;
  let number = paymentNumber;
  for (let attempt = 0; attempt < 6 && !row; attempt++) {
    try {
      [row] = await db
        .insert(payments)
        .values({
          tenantId,
          paymentNumber: number,
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
          paymentMethod: mode.paymentModeId ? mode.paymentMethod : input.paymentMethod,
          paymentModeId: mode.paymentModeId,
          paymentModeName: mode.paymentModeName,
          chequeNumber: input.chequeNumber || null,
          chequeDate: input.chequeDate || null,
          chequeBank: input.chequeBank || null,
          referenceNumber: input.referenceNumber || null,
          amount: input.amount.toFixed(2),
          description: input.description || null,
          notes: input.notes || null,
          attachmentUrl: input.attachmentUrl || null,
          status: "draft",
          origin: input.origin ?? "standalone",
          createdBy: userId,
        })
        .returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      number = await buildNextPaymentNumber(tenantId, input.direction, attempt + 1);
    }
  }
  if (!row) throw new Error("Could not allocate a payment number — please try again");
  const paymentRow = row;

  let entryId: string | null = null;
  const applied: AllocationInput[] = [];
  try {
    const entry = await postJournalEntry({
      tenantId,
      entryDate: input.paymentDate,
      sourceType: input.direction === "money_in" ? "receipt" : "payment",
      referenceNumber: number,
      memo: `${number} — ${input.paymentType.replace(/_/g, " ")}`,
      createdBy: userId,
      lines,
    });
    entryId = entry.id;

    await db.update(payments).set({ status: "posted", journalEntryId: entry.id, postedBy: userId, postedAt: new Date() }).where(eq(payments.id, paymentRow.id));

    if (input.paymentType === "staff_advance") {
      const m = input.advanceMonth!;
      await db.insert(staffAdvances).values({
        tenantId,
        employeeId: input.employeeId!,
        paymentId: paymentRow.id,
        advanceDate: input.paymentDate,
        forCalendar: m.calendar,
        forMonth: m.month,
        forYear: m.year,
        forPeriodStart: isoFromYmd(m.calendar, { year: m.year, month: m.month, day: 1 })!,
        amount: input.amount.toFixed(2),
      });
    }

    const allocations = input.allocations ?? [];
    if (allocations.length > 0) {
      await db.insert(paymentAllocations).values(
        allocations.map((a) => ({ paymentId: paymentRow.id, targetType: a.targetType, targetId: a.targetId, allocatedAmount: a.allocatedAmount.toFixed(2) }))
      );
      for (const a of allocations) {
        await applyAllocationToTarget(tenantId, a);
        applied.push(a);
      }
    }
  } catch (e) {
    await rollbackCreated(tenantId, userId, paymentRow.id, entryId, applied);
    throw e;
  }

  return { paymentId: paymentRow.id, paymentNumber: number };
}

async function isReconciled(journalEntryId: string) {
  const rows = await db
    .select({ id: bankReconciliationMatchJournalLines.journalLineId })
    .from(bankReconciliationMatchJournalLines)
    .innerJoin(journalLines, eq(journalLines.id, bankReconciliationMatchJournalLines.journalLineId))
    .where(eq(journalLines.journalEntryId, journalEntryId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Voids a standalone payment: reverses its journal entry and rolls back
 * every allocation it made on the invoices/bills/expenses it touched.
 * Embedded payments (recorded by Sales/Purchases at invoice/bill creation)
 * are never voided here — void or edit the source invoice/bill instead.
 * Refused up front (before anything changes) when today falls in a closed period, or the payment has been matched
 * in a bank reconciliation.
 */
export async function voidPayment(tenantId: string, paymentId: string, userId: string, reason: string) {
  const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId))).limit(1);
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "voided") throw new Error("Payment is already voided");
  if (payment.origin === "embedded") {
    throw new Error("This payment was recorded automatically by Sales/Purchases — void or edit the source invoice/bill instead.");
  }

  await assertPeriodOpen(tenantId, todayIso());
  if (payment.journalEntryId && (await isReconciled(payment.journalEntryId))) {
    throw new Error("This payment has been matched in a bank reconciliation — undo that match before voiding it");
  }

  if (payment.paymentType === "staff_advance") {
    // Once payroll has taken part of it back, reverse that payroll run first (its recovery is what a void would strand).
    const [adv] = await db.select({ id: staffAdvances.id }).from(staffAdvances).where(eq(staffAdvances.paymentId, paymentId)).limit(1);
    const [rec] = adv ? await db.select({ id: staffAdvanceRecoveries.id }).from(staffAdvanceRecoveries).where(eq(staffAdvanceRecoveries.advanceId, adv.id)).limit(1) : [];
    if (rec) throw new Error("Part of this advance has already been recovered through payroll — reverse that payroll run first, then void the advance");
  }

  const allocations = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  await assertAdvanceStillThere(tenantId, payment, round2(allocations.reduce((s, a) => s + Number(a.allocatedAmount), 0)));
  for (const a of allocations) {
    await revertAllocationOnTarget(tenantId, a);
  }

  if (payment.journalEntryId) {
    await reverseJournalEntry(tenantId, payment.journalEntryId, userId, `Void of payment ${payment.paymentNumber}: ${reason}`);
  }

  if (payment.paymentType === "staff_advance") await db.update(staffAdvances).set({ status: "void" }).where(eq(staffAdvances.paymentId, paymentId));
  await db
    .update(payments)
    .set({ status: "voided", voidReason: reason, voidedBy: userId, voidedAt: new Date() })
    .where(eq(payments.id, paymentId));
}

// ---------------------------------------------------------------------------------------------------------------------
// Editing a payment
// ---------------------------------------------------------------------------------------------------------------------

/** What an edit may change. The kind of payment (and so its direction) is fixed: a different kind is a different payment. */
export type UpdatePaymentInput = Omit<CreatePaymentInput, "direction" | "paymentType" | "origin" | "confirmDuplicate">;

export type UpdatePaymentResult = { changed: false } | { changed: true; changes: PaymentChange[] };
export type PaymentChange = { field: string; before: string; after: string };

type PaymentRow = typeof payments.$inferSelect;
type AllocationRow = typeof paymentAllocations.$inferSelect;

const blank = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * A payment as people read it (names, not ids), so an edit can say what changed: used for the before and after of the audit
 * log. One entry per thing a person can change.
 */
async function describePayment(tenantId: string, p: PaymentRow, allocs: { targetType: PaymentAllocationTarget; targetId: string; allocatedAmount: string }[], advanceMonth?: string | null): Promise<Record<string, string>> {
  const accountIds = [p.accountId, p.transferToAccountId, p.categoryAccountId].filter(Boolean) as string[];
  const [accountRows, customer, vendor, employee] = await Promise.all([
    accountIds.length ? db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, accountIds))) : [],
    p.customerId ? db.select({ name: customers.name }).from(customers).where(eq(customers.id, p.customerId)).limit(1) : [],
    p.vendorId ? db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, p.vendorId)).limit(1) : [],
    p.employeeId ? db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, p.employeeId)).limit(1) : [],
  ]);
  const accountName = (id: string | null) => {
    const a = accountRows.find((r) => r.id === id);
    return a ? `${a.code} — ${a.name}` : "—";
  };

  const byType = (t: PaymentAllocationTarget) => allocs.filter((a) => a.targetType === t);
  const [invoices, bills, expenseRows, obligations] = await Promise.all([
    byType("sales_invoice").length ? db.select({ id: salesInvoices.id, n: salesInvoices.invoiceNumber }).from(salesInvoices).where(inArray(salesInvoices.id, byType("sales_invoice").map((a) => a.targetId))) : [],
    byType("purchase_bill").length ? db.select({ id: purchaseBills.id, n: purchaseBills.billNumber }).from(purchaseBills).where(inArray(purchaseBills.id, byType("purchase_bill").map((a) => a.targetId))) : [],
    byType("expense").length ? db.select({ id: expenses.id, n: expenses.expenseNumber }).from(expenses).where(inArray(expenses.id, byType("expense").map((a) => a.targetId))) : [],
    byType("tax_obligation").length ? db.select({ id: complianceObligations.id, n: complianceObligations.name, period: complianceObligations.periodLabel }).from(complianceObligations).where(inArray(complianceObligations.id, byType("tax_obligation").map((a) => a.targetId))) : [],
  ]);
  const docName = (a: { targetType: PaymentAllocationTarget; targetId: string }) => {
    if (a.targetType === "sales_invoice") return invoices.find((r) => r.id === a.targetId)?.n ?? "invoice";
    if (a.targetType === "purchase_bill") return bills.find((r) => r.id === a.targetId)?.n ?? "bill";
    if (a.targetType === "expense") return expenseRows.find((r) => r.id === a.targetId)?.n ?? "expense";
    const o = obligations.find((r) => r.id === a.targetId);
    return o ? `${o.n} ${o.period}` : "tax item";
  };
  const allocationText = allocs.length
    ? allocs
        .map((a) => `${docName(a)}: ${Number(a.allocatedAmount).toFixed(2)}`)
        .sort()
        .join("; ")
    : "—";

  return {
    "Payment date": blank(p.paymentDate),
    Party: blank(customer[0]?.name ?? vendor[0]?.name ?? employee[0]?.name ?? p.partyOtherName),
    Account: accountName(p.accountId),
    "To account": accountName(p.transferToAccountId),
    "Classification account": accountName(p.categoryAccountId),
    Mode: blank(p.paymentModeName),
    Amount: Number(p.amount).toFixed(2),
    "Cheque number": blank(p.chequeNumber),
    "Cheque date": blank(p.chequeDate),
    "Cheque bank": blank(p.chequeBank),
    Reference: blank(p.referenceNumber),
    Description: blank(p.description),
    Notes: blank(p.notes),
    Attachment: blank(p.attachmentUrl),
    "Settles": allocationText,
    ...(advanceMonth ? { "Advance for month": advanceMonth } : {}),
  };
}

const monthLabelOf = (m: { calendar: string; month: number; year: number } | null | undefined) => (m ? `${m.year}-${String(m.month).padStart(2, "0")} (${m.calendar})` : null);

/** Rebuilds the input a payment was recorded with, from what is stored, so the old entry can be posted again if an edit fails. */
function inputFromRow(p: PaymentRow, allocs: AllocationRow[], advance: typeof staffAdvances.$inferSelect | null): CreatePaymentInput {
  return {
    direction: p.direction,
    paymentType: p.paymentType,
    paymentDate: p.paymentDate,
    partyType: p.partyType,
    customerId: p.customerId,
    vendorId: p.vendorId,
    employeeId: p.employeeId,
    partyOtherName: p.partyOtherName,
    accountId: p.accountId,
    paymentModeId: p.paymentModeId,
    transferToAccountId: p.transferToAccountId,
    categoryAccountId: p.categoryAccountId,
    paymentMethod: p.paymentMethod,
    chequeNumber: p.chequeNumber,
    chequeDate: p.chequeDate,
    chequeBank: p.chequeBank,
    referenceNumber: p.referenceNumber,
    amount: Number(p.amount),
    description: p.description,
    notes: p.notes,
    attachmentUrl: p.attachmentUrl,
    allocations: allocs.map((a) => ({ targetType: a.targetType, targetId: a.targetId, allocatedAmount: Number(a.allocatedAmount) })),
    advanceMonth: advance ? { calendar: advance.forCalendar as CalendarSystem, month: advance.forMonth, year: advance.forYear } : null,
  };
}

/**
 * Edits a payment recorded in the Payment module (money in or money out). The kind of payment stays; everything a person
 * typed can change: date, party, account, mode, cheque details, amount, what it settles, notes. The books are corrected the way
 * every other edit in the system is: the old journal entry is reversed and a new one is posted, under the same payment number,
 * and the invoices, bills and expenses it settled are put right. Everything that could refuse the edit is checked BEFORE
 * anything changes (a payment matched in a bank reconciliation, one recorded by an invoice or bill, a closed period, an
 * advance already used up, a balance that would no longer cover the payment); if a step still fails, the earlier steps are
 * taken back so the payment is left as it was. What changed is written to the audit log.
 */
export async function updatePayment(tenantId: string, userId: string, paymentId: string, edit: UpdatePaymentInput): Promise<UpdatePaymentResult> {
  const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId))).limit(1);
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "voided") throw new Error("A voided payment can't be edited");
  if (payment.status !== "posted") throw new Error("Only a posted payment can be edited");
  if (payment.origin === "embedded") throw new Error("This payment was recorded automatically by Sales/Purchases — edit the source invoice/bill instead.");
  if (payment.journalEntryId && (await isReconciled(payment.journalEntryId))) {
    throw new Error("This payment has been matched in a bank reconciliation — undo that match before editing it");
  }

  const oldAllocs = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  const [oldAdvance] = payment.paymentType === "staff_advance" ? await db.select().from(staffAdvances).where(eq(staffAdvances.paymentId, paymentId)).limit(1) : [];
  if (oldAdvance) {
    const [rec] = await db.select({ id: staffAdvanceRecoveries.id }).from(staffAdvanceRecoveries).where(eq(staffAdvanceRecoveries.advanceId, oldAdvance.id)).limit(1);
    if (rec) throw new Error("Part of this advance has already been recovered through payroll — reverse that payroll run first, then edit the advance");
  }
  // The advance a payment put on a customer's or supplier's account can't be changed once it has been applied or refunded.
  await assertAdvanceStillThere(tenantId, payment, round2(oldAllocs.reduce((s, a) => s + Number(a.allocatedAmount), 0)));

  const input: CreatePaymentInput = { ...edit, direction: payment.direction, paymentType: payment.paymentType, origin: "standalone" };
  const oldInput = inputFromRow(payment, oldAllocs, oldAdvance ?? null);

  // ---- everything that can refuse the edit, before anything is touched ----
  validateInput(input);
  await validateOwnership(tenantId, input);
  await assertAccountActive(tenantId, input.accountId);
  if (input.transferToAccountId) await assertAccountActive(tenantId, input.transferToAccountId);
  const mode = await resolvePaymentMode(tenantId, input.paymentModeId, input.accountId);
  await validateStaffAdvance(tenantId, input);
  await assertPeriodOpen(tenantId, payment.paymentDate);
  await assertPeriodOpen(tenantId, input.paymentDate);
  await assertPeriodOpen(tenantId, todayIso()); // the old entry is reversed today

  // What this payment itself already uses up is free again for the new version.
  const credit = new Map<string, number>();
  for (const a of oldAllocs) credit.set(a.targetId, round2((credit.get(a.targetId) ?? 0) + Number(a.allocatedAmount)));
  await validateTaxAllocations(tenantId, input, credit);
  await validateAllocations(tenantId, input, credit);
  const sameParty = (a: string | null | undefined, b: string | null | undefined) => Boolean(a) && a === b;
  await validateRefund(tenantId, input, sameParty(payment.customerId, input.customerId) ? Number(payment.amount) : 0);
  await validateSalaryPayment(tenantId, input, sameParty(payment.employeeId, input.employeeId) ? Number(payment.amount) : 0);

  // ---- what changed (nothing to do if nothing did) ----
  const newAllocsAsRows = (input.allocations ?? []).map((a) => ({ targetType: a.targetType, targetId: a.targetId, allocatedAmount: a.allocatedAmount.toFixed(2) }));
  const draftRow: PaymentRow = {
    ...payment,
    paymentDate: input.paymentDate,
    partyType: input.partyType,
    customerId: input.customerId || null,
    vendorId: input.vendorId || null,
    employeeId: input.employeeId || null,
    partyOtherName: input.partyOtherName || null,
    accountId: input.accountId,
    transferToAccountId: input.transferToAccountId || null,
    categoryAccountId: input.categoryAccountId || null,
    paymentMethod: mode.paymentModeId ? mode.paymentMethod : input.paymentMethod,
    paymentModeId: mode.paymentModeId,
    paymentModeName: mode.paymentModeName,
    chequeNumber: input.chequeNumber || null,
    chequeDate: input.chequeDate || null,
    chequeBank: input.chequeBank || null,
    referenceNumber: input.referenceNumber || null,
    amount: input.amount.toFixed(2),
    description: input.description || null,
    notes: input.notes || null,
    attachmentUrl: input.attachmentUrl || null,
  };
  const [beforeText, afterText] = await Promise.all([
    describePayment(tenantId, payment, oldAllocs, monthLabelOf(oldInput.advanceMonth)),
    describePayment(tenantId, draftRow, newAllocsAsRows, monthLabelOf(input.advanceMonth)),
  ]);
  const changes: PaymentChange[] = Object.keys(afterText)
    .filter((k) => beforeText[k] !== afterText[k])
    .map((k) => ({ field: k, before: beforeText[k] ?? "—", after: afterText[k] }));
  if (changes.length === 0) return { changed: false };

  // ---- make the change, taking it back if a step fails ----
  const progress = { allocsReverted: false, oldReversed: false, newEntryId: null as string | null, rowUpdated: false, newApplied: [] as AllocationInput[] };
  try {
    for (const a of oldAllocs) await revertAllocationOnTarget(tenantId, a);
    progress.allocsReverted = true;
    if (payment.journalEntryId) {
      await reverseJournalEntry(tenantId, payment.journalEntryId, userId, `Edit of payment ${payment.paymentNumber}`);
    }
    progress.oldReversed = true;
    await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));

    const lines = await buildLines(tenantId, input);
    const entry = await postJournalEntry({
      tenantId,
      entryDate: input.paymentDate,
      sourceType: payment.direction === "money_in" ? "receipt" : "payment",
      referenceNumber: payment.paymentNumber,
      memo: `${payment.paymentNumber} — ${payment.paymentType.replace(/_/g, " ")} (edited)`,
      createdBy: userId,
      lines,
    });
    progress.newEntryId = entry.id;

    await db
      .update(payments)
      .set({
        paymentDate: draftRow.paymentDate,
        partyType: draftRow.partyType,
        customerId: draftRow.customerId,
        vendorId: draftRow.vendorId,
        employeeId: draftRow.employeeId,
        partyOtherName: draftRow.partyOtherName,
        accountId: draftRow.accountId,
        transferToAccountId: draftRow.transferToAccountId,
        categoryAccountId: draftRow.categoryAccountId,
        paymentMethod: draftRow.paymentMethod,
        paymentModeId: draftRow.paymentModeId,
        paymentModeName: draftRow.paymentModeName,
        chequeNumber: draftRow.chequeNumber,
        chequeDate: draftRow.chequeDate,
        chequeBank: draftRow.chequeBank,
        referenceNumber: draftRow.referenceNumber,
        amount: draftRow.amount,
        description: draftRow.description,
        notes: draftRow.notes,
        attachmentUrl: draftRow.attachmentUrl,
        journalEntryId: entry.id,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
    progress.rowUpdated = true;

    if (payment.paymentType === "staff_advance") {
      const m = input.advanceMonth!;
      await db
        .update(staffAdvances)
        .set({ advanceDate: input.paymentDate, forCalendar: m.calendar, forMonth: m.month, forYear: m.year, forPeriodStart: isoFromYmd(m.calendar, { year: m.year, month: m.month, day: 1 })!, amount: input.amount.toFixed(2) })
        .where(eq(staffAdvances.paymentId, paymentId));
    }

    const allocations = input.allocations ?? [];
    if (allocations.length > 0) {
      await db.insert(paymentAllocations).values(allocations.map((a) => ({ paymentId, targetType: a.targetType, targetId: a.targetId, allocatedAmount: a.allocatedAmount.toFixed(2) })));
      for (const a of allocations) {
        await applyAllocationToTarget(tenantId, a);
        progress.newApplied.push(a);
      }
    }
  } catch (e) {
    await restoreAfterFailedEdit(tenantId, userId, payment, oldAllocs, oldAdvance ?? null, oldInput, progress);
    throw e;
  }

  await logAuditEvent({
    tenantId,
    userId,
    action: "payment_edited",
    entityType: "payment",
    entityId: paymentId,
    before: { paymentNumber: payment.paymentNumber, ...Object.fromEntries(changes.map((c) => [c.field, c.before])) },
    after: { paymentNumber: payment.paymentNumber, ...Object.fromEntries(changes.map((c) => [c.field, c.after])) },
  });
  return { changed: true, changes };
}

// Puts a payment back exactly as it was after an edit failed part-way: whatever the edit did is undone, then the old entry is
// posted again and the documents it settled are put back as they were.
async function restoreAfterFailedEdit(
  tenantId: string,
  userId: string,
  old: PaymentRow,
  oldAllocs: AllocationRow[],
  oldAdvance: typeof staffAdvances.$inferSelect | null,
  oldInput: CreatePaymentInput,
  progress: { allocsReverted: boolean; oldReversed: boolean; newEntryId: string | null; rowUpdated: boolean; newApplied: AllocationInput[] }
) {
  try {
    for (const a of progress.newApplied) {
      await revertAllocationOnTarget(tenantId, { targetType: a.targetType, targetId: a.targetId, allocatedAmount: a.allocatedAmount.toFixed(2), paymentId: old.id });
    }
    await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, old.id));
    if (progress.newEntryId) await reverseJournalEntry(tenantId, progress.newEntryId, userId, `Edit of payment ${old.paymentNumber} could not be completed`);

    let entryId = old.journalEntryId;
    if (progress.oldReversed) {
      const entry = await postJournalEntry({
        tenantId,
        entryDate: old.paymentDate,
        sourceType: old.direction === "money_in" ? "receipt" : "payment",
        referenceNumber: old.paymentNumber,
        memo: `${old.paymentNumber} — ${old.paymentType.replace(/_/g, " ")} (restored)`,
        createdBy: userId,
        lines: await buildLines(tenantId, oldInput),
      });
      entryId = entry.id;
    }
    if (progress.allocsReverted) {
      for (const a of oldAllocs) {
        await applyAllocationToTarget(tenantId, { targetType: a.targetType, targetId: a.targetId, allocatedAmount: Number(a.allocatedAmount) });
      }
    }
    if (oldAllocs.length > 0) {
      await db.insert(paymentAllocations).values(oldAllocs.map((a) => ({ paymentId: old.id, targetType: a.targetType, targetId: a.targetId, allocatedAmount: a.allocatedAmount })));
    }
    const { id: _id, tenantId: _tenant, ...oldValues } = old;
    void _id;
    void _tenant;
    await db.update(payments).set({ ...oldValues, journalEntryId: entryId }).where(eq(payments.id, old.id));
    if (oldAdvance) {
      const { id: _aid, ...advanceValues } = oldAdvance;
      void _aid;
      await db.update(staffAdvances).set(advanceValues).where(eq(staffAdvances.paymentId, old.id));
    }
  } catch (restoreError) {
    console.error(`Could not fully restore payment ${old.paymentNumber} after a failed edit — check it in Payments and the journal`, restoreError);
  }
}
