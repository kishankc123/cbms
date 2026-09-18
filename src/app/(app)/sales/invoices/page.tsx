import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { InvoicesTable } from "../invoices-table";

export default async function SalesInvoicesPage() {
  const session = await requireTenantSession();

  const [customerList, invoiceList] = await Promise.all([
    db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.tenantId, session.tenantId))
      .orderBy(desc(salesInvoices.invoiceDate)),
  ]);

  const customerById = Object.fromEntries(customerList.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
      <InvoicesTable invoiceList={invoiceList} customerById={customerById} />
    </div>
  );
}
