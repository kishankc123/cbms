import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { customers, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getPartyLines } from "@/lib/ledger/party-ledger";
import { buildStatement, partyBuckets } from "@/lib/ledger/party-statement";
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

  const [tenant] = await db.select({ fiscalYearStartDate: tenants.fiscalYearStartDate }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);

  // Everything below is read from the customer's own ledger account.
  const lines = customer.receivableAccountId ? (await getPartyLines(session.tenantId, [customer.receivableAccountId])).get(customer.receivableAccountId) ?? [] : [];
  const b = partyBuckets(lines, "debit");
  const sales = b.invoices.reduce((s, i) => s + i.total, 0);
  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  const other = b.others.reduce((s, o) => s + o.amount, 0);
  const outstanding = buildStatement(lines, "debit").closingBalance;

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
          openingBalance: Number(customer.openingBalance),
        }}
        sales={sales}
        paid={paid}
        other={Math.round(other * 100) / 100}
        outstanding={outstanding}
        fiscalYearStartDate={tenant?.fiscalYearStartDate ?? null}
      />
    </div>
  );
}
