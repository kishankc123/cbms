import { NOT_ASSIGNED, tdsHeadNames, tdsWithheldLines, totalsByHeading } from "./tds-by-heading";
import { tdsDepositPosition } from "./tds-deposits";
import { and, eq, ne, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetDisposals, salesInvoices, purchaseBills, expenses, customers, vendors, journalLines, journalEntries, salesReturns, purchaseReturns } from "@/db/schema";
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

  // An asset sold is a taxable supply too, so it belongs in the sales register (and the VAT return) even though it is not revenue.
  const assetSales = await db
    .select({
      invoiceNumber: assetDisposals.invoiceNumber,
      reference: assetDisposals.reference,
      invoiceDate: assetDisposals.disposalDate,
      customerId: assetDisposals.customerId,
      subtotal: assetDisposals.saleAmount,
      taxAmount: assetDisposals.vatAmount,
      total: assetDisposals.total,
    })
    .from(assetDisposals)
    .where(and(eq(assetDisposals.tenantId, tenantId), eq(assetDisposals.kind, "sale"), eq(assetDisposals.status, "posted"), gte(assetDisposals.disposalDate, from), lte(assetDisposals.disposalDate, to)));
  const combined = [...rows, ...assetSales.map((a) => ({ invoiceNumber: a.invoiceNumber || a.reference, invoiceDate: a.invoiceDate, customerId: a.customerId, subtotal: a.subtotal, taxAmount: a.taxAmount, total: a.total, status: "paid" as typeof rows[number]["status"] }))].sort((x, y) => x.invoiceDate.localeCompare(y.invoiceDate));

  const customerList = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId));
  const nameById = Object.fromEntries(customerList.map((c) => [c.id, c.name]));

  const active = combined.filter((r) => r.status !== "void");
  return {
    rows: combined.map((r) => ({ ...r, customerName: (r.customerId ? nameById[r.customerId] : null) ?? "—" })),
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

// VAT paid on expenses (rent, utilities, services) is input VAT too.
async function getExpenseVat(tenantId: string, from: string, to: string) {
  const rows = await db
    .select({ vat: expenses.vatAmount, taxable: expenses.taxableAmount })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to), ne(expenses.status, "void")));
  const withVat = rows.filter((r) => Number(r.vat) > 0);
  return { vat: round2(withVat.reduce((s, r) => s + Number(r.vat), 0)), taxable: round2(withVat.reduce((s, r) => s + Number(r.taxable), 0)) };
}

// Sales returns (debit notes) take VAT back off output VAT; purchase returns (credit notes) take it off input VAT.
async function getReturnsVat(tenantId: string, from: string, to: string) {
  const [sales, purchases] = await Promise.all([
    db
      .select({ subtotal: salesReturns.subtotal, tax: salesReturns.taxAmount })
      .from(salesReturns)
      .where(and(eq(salesReturns.tenantId, tenantId), gte(salesReturns.noteDate, from), lte(salesReturns.noteDate, to), ne(salesReturns.status, "void"))),
    db
      .select({ subtotal: purchaseReturns.subtotal, tax: purchaseReturns.taxAmount })
      .from(purchaseReturns)
      .where(and(eq(purchaseReturns.tenantId, tenantId), gte(purchaseReturns.noteDate, from), lte(purchaseReturns.noteDate, to), ne(purchaseReturns.status, "void"))),
  ]);
  const sum = (rows: { subtotal: string; tax: string }[], k: "subtotal" | "tax") => round2(rows.reduce((s, r) => s + Number(r[k]), 0));
  return { salesTax: sum(sales, "tax"), salesSubtotal: sum(sales, "subtotal"), purchasesTax: sum(purchases, "tax"), purchasesSubtotal: sum(purchases, "subtotal") };
}

export async function getVatReturn(tenantId: string, from: string, to: string) {
  const [sales, purchases, expenseVat, returns] = await Promise.all([
    getSalesRegister(tenantId, from, to),
    getPurchaseRegister(tenantId, from, to),
    getExpenseVat(tenantId, from, to),
    getReturnsVat(tenantId, from, to),
  ]);
  const outputVat = round2(sales.totalTax - returns.salesTax);
  const inputVat = round2(purchases.totalTax + expenseVat.vat - returns.purchasesTax);
  return {
    outputVat,
    inputVat,
    netVatPayable: round2(outputVat - inputVat),
    salesTaxable: round2(sales.totalSubtotal - returns.salesSubtotal),
    purchasesTaxable: round2(purchases.totalSubtotal + expenseVat.taxable - returns.purchasesSubtotal),
    // What the totals above are made of.
    breakdown: {
      salesVat: sales.totalTax,
      salesReturnsVat: returns.salesTax,
      purchasesVat: purchases.totalTax,
      expensesVat: expenseVat.vat,
      purchaseReturnsVat: returns.purchasesTax,
    },
  };
}

// TDS withheld in the period, by heading: expenses and salaries together. Every row keeps its heading, so the report can be grouped and each
// heading's total deposited separately; TDS from before headings existed shows as "Not assigned".
export async function getTdsReport(tenantId: string, from: string, to: string) {
  const names = await tdsHeadNames(tenantId);
  const lines = await tdsWithheldLines(tenantId, from, to);
  // What has been deposited against it: by deposit period and heading, so an unpaid month cannot hide in a total.
  const deposits = await tdsDepositPosition(tenantId, from, to);
  return {
    deposits,
    rows: lines.map((l) => ({
      expenseNumber: l.reference,
      expenseDate: l.date,
      payee: l.payee,
      taxableAmount: l.taxable.toFixed(2),
      tdsAmount: l.tds.toFixed(2),
      heading: l.headKey ? names.get(l.headKey) ?? l.headKey : NOT_ASSIGNED,
      kind: l.kind,
    })),
    byHeading: totalsByHeading(lines, names),
    totalTaxable: round2(lines.reduce((t, l) => t + l.taxable, 0)),
    totalTds: round2(lines.reduce((t, l) => t + l.tds, 0)),
  };
}

// Sums every line ever posted to the account — including reversed entries
// and their reversals. A reversal entry is never itself marked isReversed,
// so filtering on that flag would count a reversal's swapped debit/credit
// without its now-excluded original, breaking the cancellation. Reversals
// are self-canceling by construction, so the correct balance is just the
// unfiltered sum (same approach as the dashboard's trial balance check).
// With `includeChildren`, the accounts under it count too (TDS Payable has one per heading: Salary, Rent, Services...).
async function getAccountBalance(tenantId: string, codes: string[], name: string, includeChildren = false) {
  const account = await findControlAccount(tenantId, codes, name);
  if (!account) return 0;
  const ids = [account.id, ...(includeChildren ? (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, account.id)))).map((a) => a.id) : [])];
  const lines = await db
    .select({ debit: journalLines.debitAmount, credit: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, ids)));
  return round2(lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0));
}

export async function getTdsPayableBalance(tenantId: string) {
  return getAccountBalance(tenantId, ["2320"], "TDS Payable", true);
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
