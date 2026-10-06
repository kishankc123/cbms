import { guardView } from "@/components/page-guard";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { ItemsTabs } from "../items/items-tabs";
import { listRevenueAccountOptions } from "../items/actions";

export default async function OtherItemsPage() {
  const denied = await guardView("inventory");
  if (denied) return denied;
  const session = await requireTenantSession();

  const [itemList, units, revenueAccounts] = await Promise.all([
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.itemType, "other"))).orderBy(asc(items.name)),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(asc(itemUnits.name)),
    listRevenueAccountOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Other</h1>
        <p className="mt-0.5 text-sm text-gray-500">Anything else sold on an invoice that isn&apos;t stocked — non-inventory, no cost basis, can&apos;t be purchased.</p>
      </div>
      <ItemsTabs itemType="other" itemsLabel="Other items" rateLabel="Default billing rate" items={itemList} units={units} accounts={revenueAccounts} />
    </div>
  );
}
