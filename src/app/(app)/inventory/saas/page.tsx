import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { ItemsTabs } from "../items/items-tabs";
import { listRevenueAccountOptions } from "../items/actions";

export default async function SaasPage() {
  const session = await requireTenantSession();

  const [itemList, units, revenueAccounts] = await Promise.all([
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.itemType, "saas"))).orderBy(asc(items.name)),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(asc(itemUnits.name)),
    listRevenueAccountOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">SaaS</h1>
        <p className="mt-0.5 text-sm text-gray-500">Subscription/SaaS items sold on an invoice — non-inventory, with a billing rate that can later be tied to a recurring subscription.</p>
      </div>
      <ItemsTabs itemType="saas" itemsLabel="SaaS items" rateLabel="Default billing rate" items={itemList} units={units} accounts={revenueAccounts} />
    </div>
  );
}
