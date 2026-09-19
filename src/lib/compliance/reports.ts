import { and, eq, ne, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { salesInvoices, purchaseBills, expenses, customers, vendors, journalLines, journalEntries } from "@/db/schema";
import { findControlAccount } from "@/lib/ledger/control-accounts";

const round2 = (n: number) => Math.round(n * 100) / 100;

// All reports derive from posted module data — never re-entered figures —
// per the module's "don't allow manually re-entering the same accounting
// data" requirement.

export async function getSalesRegister(tenantId: string, from: string, to: string) {
  const rows = await db
    .select({
      invoiceNumber: salesInvoices.invoiceNumber,
      invoiceDate: salesInvoices.invoiceDate,
      customerId: salesInvoices.customerId,
      subtotal: salesInvoices.subtotal,
      taxAmount: salesInvoices.taxAmount,
      total: salesInvoices.total,
      status: salesInvoices.status,
    })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.tenantId, tenantId), gte(salesInvoices.invoiceDate, from), lte(salesInvoices.invoiceDate, to)))
    .orderBy(salesInvoices.invoiceDate);

  const customerList = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId));
  const nameById = Object.fromEntries(customerList.map((c) => [c.id, c.name]));

  const active = rows.filter((r) => r.status !== "void");
  return {
    rows: rows.map((r) => ({ ...r, customerName: nameById[r.customerId] ?? "—" })),
    totalSubtotal: round2(active.reduce((s, r) => s + Number(r.subtotal), 0)),
    totalTax: round2(active.reduce((s, r) => s + Number(r.taxAmount), 0)),
    totalAmount: round2(active.reduce((s, r) => s + Number(r.total), 0)),
  };
}

export async function getPurchaseRegister(tenantId: string, from: string, to: string) {
  const rows = await db
    .select({
      billNumber: purchaseBills.billNumber,
      billDate: purchaseBills.billDate,
      vendorId: purchaseBills.vendorId,
      subtotal: purchaseBills.subtotal,
      taxAmount: purchaseBills.taxAmount,
      total: purchaseBills.total,
      status: purchaseBills.status,
    })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, tenantId), gte(purchaseBills.billDate, from), lte(purchaseBills.billDate, to)))
    .orderBy(purchaseBills.billDate);

  const vendorList = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId));
  const nameById = Object.fromEntries(vendorList.map((v) => [v.id, v.name]));

  const active = rows.filter((r) => r.status !== "void");
  return {
    rows: rows.map((r) => ({ ...r, vendorName: r.vendorId ? nameById[r.vendorId] ?? "—" : "—" })),
    totalSubtotal: round2(active.reduce((s, r) => s + Number(r.subtotal), 0)),
    totalTax: round2(active.reduce((s, r) => s + Number(r.taxAmount), 0)),
    totalAmount: round2(active.reduce((s, r) => s + Number(r.total), 0)),
  };
}

export async function getVatReturn(tenantId: string, from: string, to: string) {
  const [sales, purchases] = await Promise.all([getSalesRegister(tenantId, from, to), getPurchaseRegister(tenantId, from, to)]);
  const outputVat = sales.totalTax;
  const inputVat = purchases.totalTax;
  return {
    outputVat,
    inputVat,
    netVatPayable: round2(outputVat - inputVat),
    salesTaxable: sales.totalSubtotal,
    purchasesTaxable: purchases.totalSubtotal,
  };
}

export async function getTdsReport(tenantId: string, from: string, to: string) {
  const rows = await db
    .select({
      expenseNumber: expenses.expenseNumber,
      expenseDate: expenses.expenseDate,
      vendorId: expenses.vendorId,
      payeeName: expenses.payeeName,
      taxableAmount: expenses.taxableAmount,
      tdsAmount: expenses.tdsAmount,
      status: expenses.status,
    })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to), ne(expenses.status, "void")))
    .orderBy(expenses.expenseDate);

  const withdrawn = rows.filter((r) => Number(r.tdsAmount) > 0);
  const vendorList = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId));
  const nameById = Object.fromEntries(vendorList.map((v) => [v.id, v.name]));

  return {
    rows: withdrawn.map((r) => ({ ...r, payee: r.vendorId ? nameById[r.vendorId] ?? r.payeeName ?? "—" : r.payeeName ?? "—" })),
    totalTaxable: round2(withdrawn.reduce((s, r) => s + Number(r.taxableAmount), 0)),
    totalTds: round2(withdrawn.reduce((s, r) => s + Number(r.tdsAmount), 0)),
  };
}

// Sums every line ever posted to the account — including reversed entries
// and their reversals. A reversal entry is never itself marked isReversed,
// so filtering on that flag would count a reversal's swapped debit/credit
// without its now-excluded original, breaking the cancellation. Reversals
// are self-canceling by construction, so the correct balance is just the
// unfiltered sum (same approach as the dashboard's trial balance check).
async function getAccountBalance(tenantId: string, codes: string[], name: string) {
  const account = await findControlAccount(tenantId, codes, name);
  if (!account) return 0;
  const lines = await db
    .select({ debit: journalLines.debitAmount, credit: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, account.id)));
  return round2(lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0));
}

export async function getTdsPayableBalance(tenantId: string) {
  return getAccountBalance(tenantId, ["2320"], "TDS Payable");
}

export async function getVatPayableBalance(tenantId: string) {
  return getAccountBalance(tenantId, ["2100"], "Tax Payable");
}

export async function getTaxPaymentReport(tenantId: string, from: string, to: string) {
  const [vatReturn, tds, tdsPayableBalance, vatPayableBalance] = await Promise.all([
    getVatReturn(tenantId, from, to),
    getTdsReport(tenantId, from, to),
    getTdsPayableBalance(tenantId),
    getVatPayableBalance(tenantId),
  ]);
  return { vatReturn, tds, tdsPayableBalance, vatPayableBalance };
}

export async function getMonthlyComplianceReport(tenantId: string, from: string, to: string) {
  const [sales, purchases, tax] = await Promise.all([
    getSalesRegister(tenantId, from, to),
    getPurchaseRegister(tenantId, from, to),
    getTaxPaymentReport(tenantId, from, to),
  ]);
  return {
    salesTotal: sales.totalAmount,
    purchasesTotal: purchases.totalAmount,
    ...tax,
  };
}

export type ComplianceReportType =
  | "vat_return"
  | "sales_register"
  | "purchase_register"
  | "tds_report"
  | "tds_payable"
  | "tax_payment_report"
  | "monthly_compliance_report";
