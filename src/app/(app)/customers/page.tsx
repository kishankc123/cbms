import { eq, asc, ne, and } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { CustomersTable } from "./customers-table";

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

  const rows = customerList.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.contactInfo?.phone ?? "",
    details: c.contactInfo?.details ?? "",
    openingBalance: Number(c.openingBalance),
    outstanding: Number(c.openingBalance) + (outstandingByCustomer.get(c.id) ?? 0),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>

      <CustomersTable customers={rows} />
    </div>
  );
}
