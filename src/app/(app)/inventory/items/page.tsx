import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits, itemGroups, itemCategories } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { ItemsTabs } from "./items-tabs";

export default async function ItemsPage() {
  const session = await requireTenantSession();

  const [itemList, units, groups, categories] = await Promise.all([
    db.select().from(items).where(eq(items.tenantId, session.tenantId)).orderBy(asc(items.name)),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(asc(itemUnits.name)),
    db.select().from(itemGroups).where(eq(itemGroups.tenantId, session.tenantId)).orderBy(asc(itemGroups.name)),
    db.select().from(itemCategories).where(eq(itemCategories.tenantId, session.tenantId)).orderBy(asc(itemCategories.name)),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Items</h1>
      <ItemsTabs items={itemList} units={units} groups={groups} categories={categories} />
    </div>
  );
}
