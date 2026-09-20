import { eq, asc, count, desc } from "drizzle-orm";
import { db } from "@/db";
import { customers, tenants, salesInvoices, items } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCustomerBalances } from "@/lib/ledger/customer-balances";
import { SalesEntryTabs } from "./sales-entry-tabs";
import { InvoicesTable } from "./invoices-table";
import { SalesViewTabs } from "./sales-view-tabs";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireTenantSession();
  const { view } = await searchParams;

  const [customerList, itemList, [tenant], cashBankAccounts, customerBalances, [{ value: existingInvoiceCount }], invoiceList] =
    await Promise.all([
      db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
      db.select().from(items).where(eq(items.tenantId, session.tenantId)).orderBy(asc(items.name)),
      db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
      getCashBankAccounts(session.tenantId),
      getCustomerBalances(session.tenantId),
      db.select({ value: count() }).from(salesInvoices).where(eq(salesInvoices.tenantId, session.tenantId)),
      db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, session.tenantId)).orderBy(desc(salesInvoices.invoiceDate)),
    ]);

  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;
  const customerById = Object.fromEntries(customerList.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Sales</h1>
        <p className="mt-0.5 text-sm text-gray-500">Record customer sales and review invoices.</p>
      </div>

      <SalesViewTabs
        initialView={view === "new" ? "new" : "invoices"}
        addNew={
          <SalesEntryTabs
            customers={customerList}
            items={itemList}
            vatRate={vatRate}
            cashBankAccounts={cashBankAccounts}
            customerBalances={customerBalances}
            invoiceNumbering={{
              prefix: tenant?.invoicePrefix ?? "",
              suffix: tenant?.invoiceSuffix ?? "",
              format: tenant?.invoiceNumberFormat ?? "prefix-number-suffix",
              nextSequence: existingInvoiceCount + 1,
            }}
          />
        }
        invoices={
          <InvoicesTable
            invoiceList={invoiceList}
            customerById={customerById}
            customers={customerList}
            items={itemList}
            cashBankAccounts={cashBankAccounts}
            customerBalances={customerBalances}
            vatRate={vatRate}
          />
        }
      />
    </div>
  );
}
