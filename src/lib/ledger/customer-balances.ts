import { eq, ne, and } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices, receipts } from "@/db/schema";

/**
 * Each customer's current outstanding balance: opening balance + all
 * non-void invoice totals - all receipts received. Same formula the
 * Customers page uses for its "Outstanding" column.
 */
export async function getCustomerBalances(tenantId: string): Promise<Record<string, number>> {
  const [customerList, invoices, customerReceipts] = await Promise.all([
    db.select({ id: customers.id, openingBalance: customers.openingBalance }).from(customers).where(eq(customers.tenantId, tenantId)),
    db
      .select({ customerId: salesInvoices.customerId, total: salesInvoices.total })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, tenantId), ne(salesInvoices.status, "void"))),
    db
      .select({ customerId: receipts.receivedFromCustomerId, amount: receipts.amount })
      .from(receipts)
      .where(eq(receipts.tenantId, tenantId)),
  ]);

  const balances: Record<string, number> = {};
  for (const c of customerList) balances[c.id] = Number(c.openingBalance);
  for (const inv of invoices) balances[inv.customerId] = (balances[inv.customerId] ?? 0) + Number(inv.total);
  for (const r of customerReceipts) {
    if (!r.customerId) continue;
    balances[r.customerId] = (balances[r.customerId] ?? 0) - Number(r.amount);
  }
  return balances;
}
