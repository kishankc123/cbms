import { guardView } from "@/components/page-guard";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { ItemsTabs } from "../items/items-tabs";
import { listRevenueAccountOptions } from "../items/actions";

export default async function ServicesPage() {
  const denied = await guardView("inventory");
  if (denied) return denied;
  const session = await requireTenantSession();

  const [itemList, units, revenueAccounts] = await Promise.all([
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.itemType, "service"))).orderBy(asc(items.name)),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(asc(itemUnits.name)),
    listRevenueAccountOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Services</h1>
        <p className="mt-0.5 text-sm text-gray-500">Non-inventory items sold on an invoice — a Service line never moves stock, never carries a cost, and can&apos;t be purchased.</p>
      </div>
      <ItemsTabs itemType="service" itemsLabel="Services" rateLabel="Default billing rate" items={itemList} units={units} accounts={revenueAccounts} />
    </div>
  );
}
