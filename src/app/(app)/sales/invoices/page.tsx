import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCustomerBalances } from "@/lib/ledger/customer-balances";
import { InvoicesTable } from "../invoices-table";

export default async function SalesInvoicesPage() {
  const session = await requireTenantSession();

  const [customerList, invoiceList, cashBankAccounts, customerBalances, [tenant]] = await Promise.all([
    db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.tenantId, session.tenantId))
      .orderBy(desc(salesInvoices.invoiceDate)),
    getCashBankAccounts(session.tenantId),
    getCustomerBalances(session.tenantId),
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
  ]);

  const customerById = Object.fromEntries(customerList.map((c) => [c.id, c]));
  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
      <InvoicesTable
        invoiceList={invoiceList}
        customerById={customerById}
        customers={customerList}
        cashBankAccounts={cashBankAccounts}
        customerBalances={customerBalances}
        vatRate={vatRate}
      />
    </div>
  );
}
