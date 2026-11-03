import { guardView } from "@/components/page-guard";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { ItemsTabs } from "../items/items-tabs";
import { listRevenueAccountOptions } from "../items/actions";
import { PageHeader } from "@/components/ui/page-header";

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
      <PageHeader title="Other" description="Anything else sold on an invoice that isn&apos;t stocked — non-inventory, no cost basis, can&apos;t be purchased." />
      <ItemsTabs itemType="other" itemsLabel="Other items" rateLabel="Default billing rate" items={itemList} units={units} accounts={revenueAccounts} />
    </div>
  );
}
