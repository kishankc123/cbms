import { BackButton } from "@/components/ui/back-button";
import { guardView } from "@/components/page-guard";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { vendors, tenants } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { supplierReconStatus } from "@/lib/suppliers/reconcile-status";
import { todayIso } from "@/lib/calendar";
import { getPartyLines } from "@/lib/ledger/party-ledger";
import { buildStatement, partyBuckets } from "@/lib/ledger/party-statement";
import { ProfileTabs } from "./profile-tabs";

export default async function SupplierProfilePage({ params }: { params: Promise<{ supplierId: string }> }) {
  const denied = await guardView("purchases");
  if (denied) return denied;
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
  const recon = await supplierReconStatus(session.tenantId, supplier.id, todayIso());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BackButton href="/suppliers" label="Back to Suppliers" className="mt-0.5 print:hidden" />
          <div>
            <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">{supplier.name}</h1>
            <p className="text-sm text-gray-500">Supplier</p>
          </div>
        </div>
        <Link href={`/suppliers/reconcile?supplier=${supplier.id}`} className="text-sm text-accent hover:underline">
          Reconcile with their statement
        </Link>
      </div>

      <ProfileTabs
        supplier={{
          id: supplier.id,
          name: supplier.name,
          panNumber: supplier.panNumber ?? "",
          businessType: supplier.businessType ?? "",
          phone: contactInfo?.phone ?? "",
          details: contactInfo?.details ?? "",
          openingBalance: Number(supplier.openingBalance),
        }}
        purchases={purchasesTotal}
        paid={paid}
        other={Math.round(other * 100) / 100}
        outstanding={outstanding}
        fiscalYearStartDate={tenant?.fiscalYearStartDate ?? null}
        recon={recon}
        canReconcile={can(session, "purchases", "create")}
      />
    </div>
  );
}
