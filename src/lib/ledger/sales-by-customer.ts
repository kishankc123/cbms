import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices, salesReturns } from "@/db/schema";
import { activeSalesSourceIds } from "./sales-summary";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SalesByCustomerRow = {
  customerId: string;
  accountId: string | null;
  customerName: string;
  invoiceCount: number;
  totalInvoiced: number;
  returnCount: number;
  returnAmount: number;
  netSales: number;
};

/** The same active-invoice set salesSummary() totals, grouped by customer instead of summed across all. */
export async function salesByCustomer(tenantId: string, periodStart: Date, periodEnd: Date): Promise<SalesByCustomerRow[]> {
  const { invoiceIds, returnIds } = await activeSalesSourceIds(tenantId, periodStart, periodEnd);

  const [invoices, returns] = await Promise.all([
    invoiceIds.length > 0 ? db.select({ customerId: salesInvoices.customerId, total: salesInvoices.total }).from(salesInvoices).where(inArray(salesInvoices.id, invoiceIds)) : Promise.resolve([]),
    returnIds.length > 0 ? db.select({ customerId: salesReturns.customerId, total: salesReturns.total }).from(salesReturns).where(inArray(salesReturns.id, returnIds)) : Promise.resolve([]),
  ]);

  type Agg = { invoiceCount: number; totalInvoiced: number; returnCount: number; returnAmount: number };
  const byCustomer = new Map<string, Agg>();
  const empty = (): Agg => ({ invoiceCount: 0, totalInvoiced: 0, returnCount: 0, returnAmount: 0 });

  for (const inv of invoices) {
    const a = byCustomer.get(inv.customerId) ?? empty();
    a.invoiceCount += 1;
    a.totalInvoiced = round2(a.totalInvoiced + Number(inv.total));
    byCustomer.set(inv.customerId, a);
  }
  for (const ret of returns) {
    const a = byCustomer.get(ret.customerId) ?? empty();
    a.returnCount += 1;
    a.returnAmount = round2(a.returnAmount + Number(ret.total));
    byCustomer.set(ret.customerId, a);
  }

  const customerIds = [...byCustomer.keys()];
  const customerRows = customerIds.length > 0 ? await db.select({ id: customers.id, name: customers.name, accountId: customers.receivableAccountId }).from(customers).where(inArray(customers.id, customerIds)) : [];
  const customerById = new Map(customerRows.map((c) => [c.id, c]));

  return [...byCustomer.entries()]
    .map(([customerId, a]) => ({
      customerId,
      accountId: customerById.get(customerId)?.accountId ?? null,
      customerName: customerById.get(customerId)?.name ?? "—",
      invoiceCount: a.invoiceCount,
      totalInvoiced: a.totalInvoiced,
      returnCount: a.returnCount,
      returnAmount: a.returnAmount,
      netSales: round2(a.totalInvoiced - a.returnAmount),
    }))
    .sort((a, b) => b.netSales - a.netSales);
}
