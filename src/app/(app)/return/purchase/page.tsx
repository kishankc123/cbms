import { guardView } from "@/components/page-guard";
import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentTaxRate } from "@/lib/compliance/tax-rates";
import { vendors, items, purchaseReturns } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { PurchaseReturnTabs } from "./purchase-return-tabs";

export default async function PurchaseReturnPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const denied = await guardView("purchases");
  if (denied) return denied;
  const session = await requireTenantSession();
  const { view } = await searchParams;

  const [vendorList, itemList, noteList, vatRate] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    // A purchase return mirrors what could have been purchased — only inventory-tracked items ever can be.
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.isActive, true), eq(items.inventoryTracking, true))).orderBy(asc(items.name)),
    db.select().from(purchaseReturns).where(eq(purchaseReturns.tenantId, session.tenantId)).orderBy(desc(purchaseReturns.noteDate), desc(purchaseReturns.createdAt)),
    getCurrentTaxRate(session.tenantId, "vat"),
  ]);
  return (
    <div>
      <PageHeader title="Purchase return" description="Credit notes for goods sent back to suppliers." />
      <PurchaseReturnTabs vendors={vendorList} items={itemList} vatRate={vatRate} noteList={noteList} initialTab={view === "new" ? "new" : "notes"} />
    </div>
  );
}
