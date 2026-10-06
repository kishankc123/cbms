import { guardView } from "@/components/page-guard";
import { and, eq, asc, count, desc } from "drizzle-orm";
import { db } from "@/db";
import { customers, tenants, salesInvoices, items } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCustomerBalances } from "@/lib/ledger/customer-balances";
import { salesVatRate } from "@/lib/sales/vat";
import { buildInvoiceNumber } from "@/lib/invoice-number";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { SalesEntryTabs } from "./sales-entry-tabs";
import { InvoicesTable } from "./invoices-table";
import { SalesViewTabs } from "./sales-view-tabs";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const denied = await guardView("sales");
  if (denied) return denied;
  const session = await requireTenantSession();
  const { view } = await searchParams;

  const [customerList, itemList, [tenant], cashBankAccounts, customerBalances, [{ value: existingInvoiceCount }], invoiceList] =
    await Promise.all([
      db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
      db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.isActive, true))).orderBy(asc(items.name)),
      db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
      getCashBankAccounts(session.tenantId),
      getCustomerBalances(session.tenantId),
      db.select({ value: count() }).from(salesInvoices).where(eq(salesInvoices.tenantId, session.tenantId)),
      db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, session.tenantId)).orderBy(desc(salesInvoices.invoiceDate)),
    ]);

  const vatRate = await salesVatRate(session.tenantId);
  const customerById = Object.fromEntries(customerList.map((c) => [c.id, c]));

  // Continues the same sequence Multi-invoice draws from — the same "so far + 1" starting point, skipped
  // forward past every invoice number already on record (single or multi) so the two entry forms never hand
  // out the same number.
  const takenInvoiceNumbers = new Set(invoiceList.map((inv) => inv.invoiceNumber));
  const nextInvoiceNumber = nextFreeInvoiceNumber(
    takenInvoiceNumbers,
    (n) => buildInvoiceNumber(tenant?.invoicePrefix, tenant?.invoiceSuffix, n, tenant?.invoiceNumberFormat ?? "prefix-number-suffix"),
    existingInvoiceCount + 1
  ).number;

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
            nextInvoiceNumber={nextInvoiceNumber}
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
