import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { customers, items, salesReturns } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { salesVatRate } from "@/lib/sales/vat";
import { SalesReturnTabs } from "./sales-return-tabs";

export default async function SalesReturnPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireTenantSession();
  const { view } = await searchParams;

  const [customerList, itemList, noteList, vatRate] = await Promise.all([
    db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.isActive, true))).orderBy(asc(items.name)),
    db.select().from(salesReturns).where(eq(salesReturns.tenantId, session.tenantId)).orderBy(desc(salesReturns.noteDate), desc(salesReturns.createdAt)),
    salesVatRate(session.tenantId),
  ]);

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
