import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { vendors, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getPartyLines } from "@/lib/ledger/party-ledger";
import { buildStatement, partyBuckets } from "@/lib/ledger/party-statement";
import { ProfileTabs } from "./profile-tabs";

export default async function SupplierProfilePage({ params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await params;
  const session = await requireTenantSession();

  const [supplier] = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, supplierId), eq(vendors.tenantId, session.tenantId)))
    .limit(1);
  if (!supplier) notFound();

  const [tenant] = await db.select({ fiscalYearStartDate: tenants.fiscalYearStartDate }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);

  // Everything below is read from the supplier's own ledger account.
  const lines = supplier.payableAccountId ? (await getPartyLines(session.tenantId, [supplier.payableAccountId])).get(supplier.payableAccountId) ?? [] : [];
  const b = partyBuckets(lines, "credit");
  const contactInfo = supplier.contactInfo as { phone?: string; details?: string } | null;
  const purchasesTotal = b.invoices.reduce((s, i) => s + i.total, 0);
  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  const other = b.others.reduce((s, o) => s + o.amount, 0);
  const outstanding = buildStatement(lines, "credit").closingBalance;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{supplier.name}</h1>
        <p className="text-sm text-gray-500">Supplier</p>
      </div>

      <ProfileTabs
        supplier={{
          id: supplier.id,
          name: supplier.name,
          panNumber: supplier.panNumber ?? "",
          phone: contactInfo?.phone ?? "",
          details: contactInfo?.details ?? "",
          openingBalance: Number(supplier.openingBalance),
        }}
        purchases={purchasesTotal}
        paid={paid}
        other={Math.round(other * 100) / 100}
        outstanding={outstanding}
        fiscalYearStartDate={tenant?.fiscalYearStartDate ?? null}
      />
    </div>
  );
}
