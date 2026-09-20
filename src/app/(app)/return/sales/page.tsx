import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { customers, items, salesReturns, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { SalesReturnTabs } from "./sales-return-tabs";

export default async function SalesReturnPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireTenantSession();
  const { view } = await searchParams;

  const [customerList, itemList, noteList, [tenant]] = await Promise.all([
    db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    db.select().from(items).where(eq(items.tenantId, session.tenantId)).orderBy(asc(items.name)),
    db.select().from(salesReturns).where(eq(salesReturns.tenantId, session.tenantId)).orderBy(desc(salesReturns.noteDate), desc(salesReturns.createdAt)),
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
  ]);
  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Sales Return</h1>
        <p className="mt-0.5 text-sm text-gray-500">Debit notes for goods returned or sales corrected.</p>
      </div>
      <SalesReturnTabs customers={customerList} items={itemList} vatRate={vatRate} noteList={noteList} initialTab={view === "new" ? "new" : "notes"} />
    </div>
  );
}
