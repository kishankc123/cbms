import { and, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { vendors, purchaseBills, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getSupplierPaymentRows } from "@/lib/ledger/supplier-balances";
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

  const [tenant, bills, supplierPayments] = await Promise.all([
    db
      .select({ fiscalYearStartDate: tenants.fiscalYearStartDate })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ total: purchaseBills.total })
      .from(purchaseBills)
      .where(
        and(
          eq(purchaseBills.vendorId, supplierId),
          eq(purchaseBills.tenantId, session.tenantId),
          ne(purchaseBills.status, "void")
        )
      ),
    getSupplierPaymentRows(session.tenantId, supplierId),
  ]);

  const contactInfo = supplier.contactInfo as { phone?: string; details?: string } | null;
  const openingBalance = Number(supplier.openingBalance);
  const purchasesTotal = bills.reduce((s, b) => s + Number(b.total), 0);
  const paid = supplierPayments.reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = openingBalance + purchasesTotal - paid;

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
          phone: contactInfo?.phone ?? "",
          details: contactInfo?.details ?? "",
          openingBalance,
        }}
        purchases={purchasesTotal}
        paid={paid}
        outstanding={outstanding}
        fiscalYearStartDate={tenant?.fiscalYearStartDate ?? null}
      />
    </div>
  );
}
