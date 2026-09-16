import Link from "next/link";
import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices, accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { voidInvoice } from "./actions";
import { InvoiceForm } from "./invoice-form";

export default async function SalesPage() {
  const session = await requireTenantSession();

  const [customerList, invoiceList, incomeAccounts] = await Promise.all([
    db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.tenantId, session.tenantId))
      .orderBy(desc(salesInvoices.invoiceDate)),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.category, "income")))
      .orderBy(asc(accounts.code)),
  ]);

  const customerById = new Map(customerList.map((c) => [c.id, c]));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Sales</h1>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">New invoice</h2>
          <Link href="/customers" className="text-sm text-[var(--color-primary)] hover:underline">
            Manage customers
          </Link>
        </div>
        <InvoiceForm customers={customerList} incomeAccounts={incomeAccounts} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Invoices</h2>
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice #</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {invoiceList.map((inv) => (
              <tr key={inv.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono">{inv.invoiceNumber}</td>
                <td className="px-4 py-2">{customerById.get(inv.customerId)?.name ?? "—"}</td>
                <td className="px-4 py-2">{inv.invoiceDate}</td>
                <td className="px-4 py-2">
                  {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2 capitalize">{inv.status.replace("_", " ")}</td>
                <td className="px-4 py-2 text-right">
                  {inv.status !== "void" && (
                    <form action={voidInvoice}>
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <button type="submit" className="text-red-600 hover:underline text-xs">
                        Void
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {invoiceList.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  No invoices yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
