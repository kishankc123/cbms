import { and, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { customers, salesInvoices, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCustomerPaymentRows } from "@/lib/ledger/customer-balances";
import { ProfileTabs } from "./profile-tabs";

export default async function CustomerProfilePage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const session = await requireTenantSession();

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!customer) notFound();

  const [tenant, invoices, customerReceipts] = await Promise.all([
    db
      .select({ fiscalYearStartDate: tenants.fiscalYearStartDate })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ total: salesInvoices.total })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.customerId, customerId),
          eq(salesInvoices.tenantId, session.tenantId),
          ne(salesInvoices.status, "void")
        )
      ),
    getCustomerPaymentRows(session.tenantId, customerId),
  ]);

  const openingBalance = Number(customer.openingBalance);
  const sales = invoices.reduce((s, i) => s + Number(i.total), 0);
  const paid = customerReceipts.reduce((s, r) => s + Number(r.amount), 0);
  const outstanding = openingBalance + sales - paid;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{customer.name}</h1>
        <p className="text-sm text-gray-500">Customer</p>
      </div>

      <ProfileTabs
        customer={{
          id: customer.id,
          name: customer.name,
          panNumber: customer.panNumber ?? "",
          phone: customer.contactInfo?.phone ?? "",
          details: customer.contactInfo?.details ?? "",
          openingBalance,
        }}
        sales={sales}
        paid={paid}
        outstanding={outstanding}
        fiscalYearStartDate={tenant?.fiscalYearStartDate ?? null}
      />
    </div>
  );
}
