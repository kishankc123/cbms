import { eq, asc, ne, and } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { AddCustomerModal } from "./add-customer-modal";

export default async function CustomersPage() {
  const session = await requireTenantSession();

  const [customerList, invoices] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, session.tenantId))
      .orderBy(asc(customers.name)),
    db
      .select({
        customerId: salesInvoices.customerId,
        total: salesInvoices.total,
        amountPaid: salesInvoices.amountPaid,
      })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, session.tenantId), ne(salesInvoices.status, "void"))),
  ]);

  const outstandingByCustomer = new Map<string, number>();
  for (const inv of invoices) {
    const due = Number(inv.total) - Number(inv.amountPaid);
    outstandingByCustomer.set(inv.customerId, (outstandingByCustomer.get(inv.customerId) ?? 0) + due);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>
        <AddCustomerModal />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Contact number</th>
            <th className="px-4 py-2 font-medium">Address</th>
            <th className="px-4 py-2 font-medium">Outstanding (AR)</th>
          </tr>
        </thead>
        <tbody>
          {customerList.map((c) => {
            const outstanding = Number(c.openingBalance) + (outstandingByCustomer.get(c.id) ?? 0);
            return (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{c.name}</td>
                <td className="px-4 py-2 text-gray-500">{c.contactInfo?.phone || "—"}</td>
                <td className="px-4 py-2 text-gray-500">{c.contactInfo?.details || "—"}</td>
                <td className="px-4 py-2">{outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
          {customerList.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                No customers yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
