"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gte, lte, or, ilike, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  payments,
  paymentAllocations,
  customers,
  vendors,
  employees,
  accounts,
  salesInvoices,
  purchaseBills,
  expenses,
  journalLines,
  bankReconciliationMatchJournalLines,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import {
  createPayment as createPaymentEngine,
  voidPayment as voidPaymentEngine,
  MONEY_IN_TYPES,
  MONEY_OUT_TYPES,
  ALLOCATABLE_TYPES,
  TRANSFER_TYPES,
  type CreatePaymentInput,
  type PaymentType,
  type PaymentDirection,
} from "@/lib/ledger/payments-engine";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Form support data ----------

export async function getPaymentFormOptions() {
  const session = await requireTenantSession();

  const [customerList, vendorList, employeeList, cashBankAccounts, incomeAccounts, expenseAccounts, taxAccounts] = await Promise.all([
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    db.select({ id: employees.id, name: employees.fullName }).from(employees).where(eq(employees.tenantId, session.tenantId)).orderBy(asc(employees.fullName)),
    getCashBankAccounts(session.tenantId),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.category, "income"), eq(accounts.isActive, true))).orderBy(accounts.code),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.category, "expense"), eq(accounts.isActive, true))).orderBy(accounts.code),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.category, "liability"), eq(accounts.isActive, true), or(ilike(accounts.name, "%tax%"), ilike(accounts.name, "%tds%")))).orderBy(accounts.code),
  ]);

  return { customers: customerList, vendors: vendorList, employees: employeeList, cashBankAccounts, incomeAccounts, expenseAccounts, taxAccounts };
}

export async function getOutstandingInvoicesForCustomer(customerId: string) {
  const session = await requireTenantSession();
  const rows = await db
    .select({ id: salesInvoices.id, invoiceNumber: salesInvoices.invoiceNumber, invoiceDate: salesInvoices.invoiceDate, total: salesInvoices.total, amountPaid: salesInvoices.amountPaid, status: salesInvoices.status })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.tenantId, session.tenantId), eq(salesInvoices.customerId, customerId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue"])))
    .orderBy(asc(salesInvoices.invoiceDate));

  return rows.map((r) => ({ ...r, outstanding: round2(Number(r.total) - Number(r.amountPaid)) })).filter((r) => r.outstanding > 0.005);
}

export async function getOutstandingBillsForSupplier(vendorId: string) {
  const session = await requireTenantSession();
  const rows = await db
    .select({ id: purchaseBills.id, billNumber: purchaseBills.billNumber, billDate: purchaseBills.billDate, total: purchaseBills.total, amountPaid: purchaseBills.amountPaid, status: purchaseBills.status })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, session.tenantId), eq(purchaseBills.vendorId, vendorId), inArray(purchaseBills.status, ["open", "partially_paid", "overdue"])))
    .orderBy(asc(purchaseBills.billDate));

  return rows.map((r) => ({ ...r, outstanding: round2(Number(r.total) - Number(r.amountPaid)) })).filter((r) => r.outstanding > 0.005);
}

export async function getOutstandingExpenses(vendorId?: string | null) {
  const session = await requireTenantSession();
  const conditions = [eq(expenses.tenantId, session.tenantId), inArray(expenses.status, ["unpaid", "partially_paid"])];
  if (vendorId) conditions.push(eq(expenses.vendorId, vendorId));

  const rows = await db
    .select({ id: expenses.id, expenseNumber: expenses.expenseNumber, expenseDate: expenses.expenseDate, amountPayable: expenses.amountPayable, amountPaid: expenses.amountPaid, description: expenses.description })
    .from(expenses)
    .where(and(...conditions))
    .orderBy(asc(expenses.expenseDate));

  return rows.map((r) => ({ ...r, outstanding: round2(Number(r.amountPayable) - Number(r.amountPaid)) })).filter((r) => r.outstanding > 0.005);
}

// ---------- Create / void ----------

export type PaymentAllocationInput = { targetType: "sales_invoice" | "purchase_bill" | "expense"; targetId: string; allocatedAmount: number };

export type CreatePaymentActionInput = Omit<CreatePaymentInput, "allocations"> & { allocations?: PaymentAllocationInput[] };

export async function createPayment(input: CreatePaymentActionInput) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "create")) throw new Error("Not permitted");

  const paymentNumber = await buildNextPaymentNumber(session.tenantId, input.direction);
  const result = await createPaymentEngine(session.tenantId, session.userId, paymentNumber, input);

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/sales/invoices");
  revalidatePath("/purchases/stockable");
  revalidatePath("/expenses");
  revalidatePath("/customers");
  revalidatePath("/suppliers");
  return result;
}

export async function voidPayment(paymentId: string, reason: string) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "delete")) throw new Error("Not permitted");
  if (!reason.trim()) throw new Error("A void reason is required");

  await voidPaymentEngine(session.tenantId, paymentId, session.userId, reason.trim());

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/sales/invoices");
  revalidatePath("/purchases/stockable");
  revalidatePath("/expenses");
  revalidatePath("/customers");
  revalidatePath("/suppliers");
}

// ---------- List / filters / summary ----------

export type PaymentListFilters = {
  from?: string;
  to?: string;
  direction?: "all" | PaymentDirection;
  paymentType?: PaymentType | "all";
  accountId?: string;
  partyType?: "all" | "customer" | "supplier" | "employee" | "other";
  partyId?: string;
  status?: "all" | "draft" | "posted" | "voided" | "partially_allocated" | "fully_allocated" | "unallocated" | "reconciled";
  search?: string;
};

async function buildPartyNames(tenantId: string, rows: (typeof payments.$inferSelect)[]) {
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
  const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter(Boolean))] as string[];
  const employeeIds = [...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[];

  const [customerRows, vendorRows, employeeRows] = await Promise.all([
    customerIds.length ? db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds)) : [],
    vendorIds.length ? db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, vendorIds)) : [],
    employeeIds.length ? db.select({ id: employees.id, name: employees.fullName }).from(employees).where(inArray(employees.id, employeeIds)) : [],
  ]);

  const customerById = Object.fromEntries(customerRows.map((c) => [c.id, c.name]));
  const vendorById = Object.fromEntries(vendorRows.map((v) => [v.id, v.name]));
  const employeeById = Object.fromEntries(employeeRows.map((e) => [e.id, e.name]));

  return (r: typeof payments.$inferSelect) =>
    r.customerId ? customerById[r.customerId] ?? "—" : r.vendorId ? vendorById[r.vendorId] ?? "—" : r.employeeId ? employeeById[r.employeeId] ?? "—" : r.partyOtherName ?? "—";
}

async function getAllocationStatusMap(tenantId: string, paymentIds: string[]) {
  if (paymentIds.length === 0) return new Map<string, number>();
  const rows = await db.select({ paymentId: paymentAllocations.paymentId, allocatedAmount: paymentAllocations.allocatedAmount }).from(paymentAllocations).where(inArray(paymentAllocations.paymentId, paymentIds));
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.paymentId, (map.get(r.paymentId) ?? 0) + Number(r.allocatedAmount));
  return map;
}

async function getReconciledJournalEntryIds(tenantId: string, journalEntryIds: string[]): Promise<Set<string>> {
  if (journalEntryIds.length === 0) return new Set();
  const rows = await db
    .select({ journalEntryId: journalLines.journalEntryId })
    .from(bankReconciliationMatchJournalLines)
    .innerJoin(journalLines, eq(journalLines.id, bankReconciliationMatchJournalLines.journalLineId))
    .where(inArray(journalLines.journalEntryId, journalEntryIds));
  return new Set(rows.map((r) => r.journalEntryId));
}

export async function listPayments(filters: PaymentListFilters) {
  const session = await requireTenantSession();

  const conditions = [eq(payments.tenantId, session.tenantId)];
  if (filters.from) conditions.push(gte(payments.paymentDate, filters.from));
  if (filters.to) conditions.push(lte(payments.paymentDate, filters.to));
  if (filters.direction && filters.direction !== "all") conditions.push(eq(payments.direction, filters.direction));
  if (filters.paymentType && filters.paymentType !== "all") conditions.push(eq(payments.paymentType, filters.paymentType));
  if (filters.accountId) conditions.push(eq(payments.accountId, filters.accountId));
  if (filters.partyType && filters.partyType !== "all") conditions.push(eq(payments.partyType, filters.partyType));
  if (filters.partyId) {
    conditions.push(or(eq(payments.customerId, filters.partyId), eq(payments.vendorId, filters.partyId), eq(payments.employeeId, filters.partyId))!);
  }
  if (filters.status && filters.status !== "all" && ["draft", "posted", "voided"].includes(filters.status)) {
    conditions.push(eq(payments.status, filters.status as "draft" | "posted" | "voided"));
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(payments.paymentNumber, term),
        ilike(payments.referenceNumber, term),
        ilike(payments.description, term),
        ilike(payments.partyOtherName, term),
        ilike(payments.chequeNumber, term)
      )!
    );
  }

  const rows = await db
    .select()
    .from(payments)
    .where(and(...conditions))
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt));

  const partyNameFor = await buildPartyNames(session.tenantId, rows);
  const allocMap = await getAllocationStatusMap(session.tenantId, rows.map((r) => r.id));
  const journalEntryIds = rows.map((r) => r.journalEntryId).filter(Boolean) as string[];
  const reconciledSet = await getReconciledJournalEntryIds(session.tenantId, journalEntryIds);

  const accountRows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(eq(accounts.tenantId, session.tenantId));
  const accountNameById = Object.fromEntries(accountRows.map((a) => [a.id, `${a.code} — ${a.name}`]));

  let results = rows.map((r) => {
    const allocated = allocMap.get(r.id) ?? 0;
    const amount = Number(r.amount);
    const allocationStatus: "unallocated" | "partially_allocated" | "fully_allocated" | "n/a" = !ALLOCATABLE_TYPES.includes(r.paymentType)
      ? "n/a"
      : allocated <= 0.005
        ? "unallocated"
        : allocated >= amount - 0.005
          ? "fully_allocated"
          : "partially_allocated";
    return {
      id: r.id,
      paymentNumber: r.paymentNumber,
      paymentDate: r.paymentDate,
      direction: r.direction,
      paymentType: r.paymentType,
      party: partyNameFor(r),
      accountName: accountNameById[r.accountId] ?? "—",
      referenceNumber: r.referenceNumber,
      chequeNumber: r.chequeNumber,
      amount,
      status: r.status,
      origin: r.origin,
      allocationStatus,
      reconciliationStatus: r.journalEntryId && reconciledSet.has(r.journalEntryId) ? "reconciled" : "unreconciled",
    };
  });

  if (filters.status === "unallocated") results = results.filter((r) => r.allocationStatus === "unallocated");
  if (filters.status === "partially_allocated") results = results.filter((r) => r.allocationStatus === "partially_allocated");
  if (filters.status === "fully_allocated") results = results.filter((r) => r.allocationStatus === "fully_allocated");
  if (filters.status === "reconciled") results = results.filter((r) => r.reconciliationStatus === "reconciled");

  return results;
}

export async function getPaymentSummary(filters: Pick<PaymentListFilters, "from" | "to" | "direction">) {
  const session = await requireTenantSession();
  const conditions = [eq(payments.tenantId, session.tenantId), ne(payments.status, "voided")];
  if (filters.from) conditions.push(gte(payments.paymentDate, filters.from));
  if (filters.to) conditions.push(lte(payments.paymentDate, filters.to));
  if (filters.direction && filters.direction !== "all") conditions.push(eq(payments.direction, filters.direction));

  const rows = await db.select().from(payments).where(and(...conditions));
  const allocMap = await getAllocationStatusMap(session.tenantId, rows.map((r) => r.id));
  const journalEntryIds = rows.map((r) => r.journalEntryId).filter(Boolean) as string[];
  const reconciledSet = await getReconciledJournalEntryIds(session.tenantId, journalEntryIds);

  let totalReceived = 0;
  let totalPaid = 0;
  let unallocated = 0;
  let reconciled = 0;

  for (const r of rows) {
    const amount = Number(r.amount);
    if (r.direction === "money_in") totalReceived += amount;
    else totalPaid += amount;

    if (ALLOCATABLE_TYPES.includes(r.paymentType)) {
      const allocated = allocMap.get(r.id) ?? 0;
      unallocated += Math.max(amount - allocated, 0);
    }
    if (r.journalEntryId && reconciledSet.has(r.journalEntryId)) reconciled += amount;
  }

  return { totalReceived: round2(totalReceived), totalPaid: round2(totalPaid), unallocated: round2(unallocated), reconciled: round2(reconciled) };
}

// ---------- Detail ----------

export async function getPaymentDetail(paymentId: string) {
  const session = await requireTenantSession();
  const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, session.tenantId))).limit(1);
  if (!payment) throw new Error("Payment not found");

  const partyNameFor = await buildPartyNames(session.tenantId, [payment]);
  const allocations = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));

  const [invoiceRows, billRows, expenseRows] = await Promise.all([
    db.select({ id: salesInvoices.id, label: salesInvoices.invoiceNumber, total: salesInvoices.total, amountPaid: salesInvoices.amountPaid }).from(salesInvoices).where(inArray(salesInvoices.id, allocations.filter((a) => a.targetType === "sales_invoice").map((a) => a.targetId).length ? allocations.filter((a) => a.targetType === "sales_invoice").map((a) => a.targetId) : ["00000000-0000-0000-0000-000000000000"])),
    db.select({ id: purchaseBills.id, label: purchaseBills.billNumber, total: purchaseBills.total, amountPaid: purchaseBills.amountPaid }).from(purchaseBills).where(inArray(purchaseBills.id, allocations.filter((a) => a.targetType === "purchase_bill").map((a) => a.targetId).length ? allocations.filter((a) => a.targetType === "purchase_bill").map((a) => a.targetId) : ["00000000-0000-0000-0000-000000000000"])),
    db.select({ id: expenses.id, label: expenses.expenseNumber, total: expenses.amountPayable, amountPaid: expenses.amountPaid }).from(expenses).where(inArray(expenses.id, allocations.filter((a) => a.targetType === "expense").map((a) => a.targetId).length ? allocations.filter((a) => a.targetType === "expense").map((a) => a.targetId) : ["00000000-0000-0000-0000-000000000000"])),
  ]);
  const targetLabelById = new Map<string, { label: string; total: number; amountPaid: number }>();
  for (const r of [...invoiceRows, ...billRows, ...expenseRows]) targetLabelById.set(r.id, { label: r.label, total: Number(r.total), amountPaid: Number(r.amountPaid) });

  const allocationDetails = allocations.map((a) => {
    const target = targetLabelById.get(a.targetId);
    return {
      targetType: a.targetType,
      targetId: a.targetId,
      label: target?.label ?? "—",
      allocatedAmount: Number(a.allocatedAmount),
      outstandingAfter: target ? round2(target.total - target.amountPaid) : null,
    };
  });

  const accountRows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(eq(accounts.tenantId, session.tenantId));
  const accountNameById = Object.fromEntries(accountRows.map((a) => [a.id, `${a.code} — ${a.name}`]));

  let journalLinesOut: { accountName: string; debit: number; credit: number }[] = [];
  if (payment.journalEntryId) {
    const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, payment.journalEntryId));
    journalLinesOut = lines.map((l) => ({ accountName: accountNameById[l.accountId] ?? "—", debit: Number(l.debitAmount), credit: Number(l.creditAmount) }));
  }

  let reconciliationStatus: "reconciled" | "unreconciled" = "unreconciled";
  if (payment.journalEntryId) {
    const reconciledSet = await getReconciledJournalEntryIds(session.tenantId, [payment.journalEntryId]);
    reconciliationStatus = reconciledSet.has(payment.journalEntryId) ? "reconciled" : "unreconciled";
  }

  return {
    ...payment,
    amount: Number(payment.amount),
    party: partyNameFor(payment),
    accountName: accountNameById[payment.accountId] ?? "—",
    transferToAccountName: payment.transferToAccountId ? accountNameById[payment.transferToAccountId] ?? "—" : null,
    allocations: allocationDetails,
    journalLines: journalLinesOut,
    reconciliationStatus,
  };
}

// ---------- CSV export (respects filters) ----------

export async function exportPaymentsCsv(filters: PaymentListFilters): Promise<string> {
  const rows = await listPayments(filters);
  const header = ["Payment No.", "Date", "Direction", "Type", "Party", "Account", "Reference", "Amount", "Allocation", "Reconciliation", "Status"];
  const lines = rows.map((r) =>
    [r.paymentNumber, r.paymentDate, r.direction, r.paymentType, r.party, r.accountName, r.referenceNumber ?? "", r.amount.toFixed(2), r.allocationStatus, r.reconciliationStatus, r.status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}
