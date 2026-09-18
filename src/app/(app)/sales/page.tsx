import Link from "next/link";
import { eq, asc, count } from "drizzle-orm";
import { db } from "@/db";
import { customers, tenants, salesInvoices, items } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCustomerBalances } from "@/lib/ledger/customer-balances";
import { SalesEntryTabs } from "./sales-entry-tabs";

export default async function SalesPage() {
  const session = await requireTenantSession();

  const [customerList, itemList, [tenant], cashBankAccounts, customerBalances, [{ value: existingInvoiceCount }]] =
    await Promise.all([
      db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
      db.select().from(items).where(eq(items.tenantId, session.tenantId)).orderBy(asc(items.name)),
      db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
      getCashBankAccounts(session.tenantId),
      getCustomerBalances(session.tenantId),
      db.select({ value: count() }).from(salesInvoices).where(eq(salesInvoices.tenantId, session.tenantId)),
    ]);

  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Add new sale</h1>
        <Link href="/customers" className="text-sm text-[var(--color-primary)] hover:underline">
          Manage customers
        </Link>
      </div>

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
    </div>
  );
}
