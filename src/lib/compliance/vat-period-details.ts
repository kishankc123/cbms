// What a VAT period's Net sales and Net purchase are made of: every sale, sales return, purchase, expense with VAT and purchase
// return in the period, with date, number, party, taxable amount and VAT. Returns count negative, so each side adds up to the
// worksheet figure (the same rules as getVatReturn: voided documents are left out, and only expenses carrying VAT count).
import { and, eq, gte, lte, ne, gt } from "drizzle-orm";
import { db } from "@/db";
import { customers, expenses, purchaseReturns, salesReturns, vendors } from "@/db/schema";
import { getPurchaseRegister, getSalesRegister } from "./reports";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type VatDetailKind = "sale" | "asset_sale" | "sales_return" | "purchase" | "expense" | "purchase_return";

export type VatDetailLine = {
  kind: VatDetailKind;
  date: string;
  number: string;
  party: string;
  /** Taxable amount; negative for a return. */
  taxable: number;
  /** VAT; negative for a return. */
  vat: number;
};

export type VatPeriodDetails = {
  sales: VatDetailLine[];
  purchases: VatDetailLine[];
  salesTaxable: number;
  salesVat: number;
  purchasesTaxable: number;
  purchasesVat: number;
};

const byDate = (a: VatDetailLine, b: VatDetailLine) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number.localeCompare(b.number));
const sum = (lines: VatDetailLine[], k: "taxable" | "vat") => round2(lines.reduce((s, l) => s + l[k], 0));

export async function getVatPeriodDetails(tenantId: string, from: string, to: string): Promise<VatPeriodDetails> {
  const [salesRegister, purchaseRegister, expenseRows, salesReturnRows, purchaseReturnRows, customerList, vendorList] = await Promise.all([
    getSalesRegister(tenantId, from, to),
    getPurchaseRegister(tenantId, from, to),
    db
      .select({ number: expenses.expenseNumber, date: expenses.expenseDate, vendorId: expenses.vendorId, payee: expenses.payeeName, taxable: expenses.taxableAmount, vat: expenses.vatAmount })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to), ne(expenses.status, "void"), gt(expenses.vatAmount, "0"))),
    db
      .select({ number: salesReturns.noteNumber, date: salesReturns.noteDate, customerId: salesReturns.customerId, taxable: salesReturns.subtotal, vat: salesReturns.taxAmount })
      .from(salesReturns)
      .where(and(eq(salesReturns.tenantId, tenantId), gte(salesReturns.noteDate, from), lte(salesReturns.noteDate, to), ne(salesReturns.status, "void"))),
    db
      .select({ number: purchaseReturns.noteNumber, date: purchaseReturns.noteDate, vendorId: purchaseReturns.vendorId, taxable: purchaseReturns.subtotal, vat: purchaseReturns.taxAmount })
      .from(purchaseReturns)
      .where(and(eq(purchaseReturns.tenantId, tenantId), gte(purchaseReturns.noteDate, from), lte(purchaseReturns.noteDate, to), ne(purchaseReturns.status, "void"))),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)),
  ]);
  const customerName = new Map(customerList.map((c) => [c.id, c.name]));
  const vendorName = new Map(vendorList.map((v) => [v.id, v.name]));

  const sales: VatDetailLine[] = [
    ...salesRegister.rows
      .filter((r) => r.status !== "void")
      .map((r) => ({ kind: "sale" as const, date: r.invoiceDate, number: r.invoiceNumber ?? "—", party: r.customerName, taxable: Number(r.subtotal), vat: Number(r.taxAmount) })),
    ...salesReturnRows.map((r) => ({ kind: "sales_return" as const, date: r.date, number: r.number, party: customerName.get(r.customerId) ?? "—", taxable: -Number(r.taxable), vat: -Number(r.vat) })),
  ].sort(byDate);

  const purchases: VatDetailLine[] = [
    ...purchaseRegister.rows
      .filter((r) => r.status !== "void")
      .map((r) => ({ kind: "purchase" as const, date: r.billDate, number: r.billNumber, party: r.vendorName, taxable: Number(r.subtotal), vat: Number(r.taxAmount) })),
    ...expenseRows.map((r) => ({ kind: "expense" as const, date: r.date, number: r.number, party: (r.vendorId ? vendorName.get(r.vendorId) : null) ?? r.payee ?? "—", taxable: Number(r.taxable), vat: Number(r.vat) })),
    ...purchaseReturnRows.map((r) => ({ kind: "purchase_return" as const, date: r.date, number: r.number, party: vendorName.get(r.vendorId) ?? "—", taxable: -Number(r.taxable), vat: -Number(r.vat) })),
  ].sort(byDate);

  return { sales, purchases, salesTaxable: sum(sales, "taxable"), salesVat: sum(sales, "vat"), purchasesTaxable: sum(purchases, "taxable"), purchasesVat: sum(purchases, "vat") };
}
