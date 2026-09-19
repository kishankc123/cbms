import { eq, ne, and } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices, payments, paymentAllocations } from "@/db/schema";

/**
 * Payments actually applied against this customer's invoices — i.e. the
 * allocated amount from the unified Payment module, not a payment's full
 * amount (an overpayment's unallocated remainder becomes a Customer Advance
 * instead of reducing what's owed on any invoice). Voided payments are
 * excluded since their allocation was rolled back.
 */
export async function getCustomerPaymentRows(tenantId: string, customerId?: string) {
  const conditions = [
    eq(payments.tenantId, tenantId),
    eq(paymentAllocations.targetType, "sales_invoice"),
    ne(payments.status, "voided"),
  ];
  if (customerId) conditions.push(eq(salesInvoices.customerId, customerId));

  return db
    .select({ customerId: salesInvoices.customerId, date: payments.paymentDate, amount: paymentAllocations.allocatedAmount })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(salesInvoices, eq(salesInvoices.id, paymentAllocations.targetId))
    .where(and(...conditions));
}

/**
 * Each customer's current outstanding balance: opening balance + all
 * non-void invoice totals - all payments allocated against those invoices.
 * Same formula the Customers page uses for its "Outstanding" column.
 */
export async function getCustomerBalances(tenantId: string): Promise<Record<string, number>> {
  const [customerList, invoices, customerPayments] = await Promise.all([
    db.select({ id: customers.id, openingBalance: customers.openingBalance }).from(customers).where(eq(customers.tenantId, tenantId)),
    db
      .select({ customerId: salesInvoices.customerId, total: salesInvoices.total })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, tenantId), ne(salesInvoices.status, "void"))),
    getCustomerPaymentRows(tenantId),
  ]);

  const balances: Record<string, number> = {};
  for (const c of customerList) balances[c.id] = Number(c.openingBalance);
  for (const inv of invoices) balances[inv.customerId] = (balances[inv.customerId] ?? 0) + Number(inv.total);
  for (const r of customerPayments) {
    if (!r.customerId) continue;
    balances[r.customerId] = (balances[r.customerId] ?? 0) - Number(r.amount);
  }
  return balances;
}
