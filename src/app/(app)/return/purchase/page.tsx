import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, items, purchaseReturns, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { PurchaseReturnTabs } from "./purchase-return-tabs";

export default async function PurchaseReturnPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireTenantSession();
  const { view } = await searchParams;

  const [vendorList, itemList, noteList, [tenant]] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    db.select().from(items).where(eq(items.tenantId, session.tenantId)).orderBy(asc(items.name)),
    db.select().from(purchaseReturns).where(eq(purchaseReturns.tenantId, session.tenantId)).orderBy(desc(purchaseReturns.noteDate), desc(purchaseReturns.createdAt)),
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
  ]);
  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Purchase Return</h1>
        <p className="mt-0.5 text-sm text-gray-500">Credit notes for goods sent back to suppliers.</p>
      </div>
      <PurchaseReturnTabs vendors={vendorList} items={itemList} vatRate={vatRate} noteList={noteList} initialTab={view === "new" ? "new" : "notes"} />
    </div>
  );
}
