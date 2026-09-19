import { eq, asc, ne, and } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCustomerPaymentRows } from "@/lib/ledger/customer-balances";
import { CustomersTable } from "./customers-table";

export default async function CustomersPage() {
  const session = await requireTenantSession();

  const [customerList, invoices, customerReceipts] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, session.tenantId))
      .orderBy(asc(customers.name)),
    db
      .select({ customerId: salesInvoices.customerId, date: salesInvoices.invoiceDate, total: salesInvoices.total })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, session.tenantId), ne(salesInvoices.status, "void"))),
    getCustomerPaymentRows(session.tenantId),
  ]);

  const invoicesByCustomer = new Map<string, { date: string; total: number }[]>();
  for (const inv of invoices) {
    const list = invoicesByCustomer.get(inv.customerId) ?? [];
    list.push({ date: inv.date, total: Number(inv.total) });
    invoicesByCustomer.set(inv.customerId, list);
  }

  const receiptsByCustomer = new Map<string, { date: string; amount: number }[]>();
  for (const r of customerReceipts) {
    if (!r.customerId) continue;
    const list = receiptsByCustomer.get(r.customerId) ?? [];
    list.push({ date: r.date, amount: Number(r.amount) });
    receiptsByCustomer.set(r.customerId, list);
  }

  const rows = customerList.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.contactInfo?.phone ?? "",
    details: c.contactInfo?.details ?? "",
    openingBalance: Number(c.openingBalance),
    invoices: invoicesByCustomer.get(c.id) ?? [],
    receipts: receiptsByCustomer.get(c.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>

      <CustomersTable customers={rows} />
    </div>
  );
}
