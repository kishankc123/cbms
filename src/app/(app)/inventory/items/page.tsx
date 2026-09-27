import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits, itemGroups, itemCategories } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { ProductTabs } from "../product-tabs";
import { ItemsTabs } from "./items-tabs";
import { listRevenueAccountOptions } from "./actions";

export default async function ItemsPage() {
  const session = await requireTenantSession();

  const [itemList, units, groups, categories, revenueAccounts] = await Promise.all([
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.itemType, "product"))).orderBy(asc(items.name)),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(asc(itemUnits.name)),
    db.select().from(itemGroups).where(eq(itemGroups.tenantId, session.tenantId)).orderBy(asc(itemGroups.name)),
    db.select().from(itemCategories).where(eq(itemCategories.tenantId, session.tenantId)).orderBy(asc(itemCategories.name)),
    listRevenueAccountOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Product</h1>
        <p className="mt-0.5 text-sm text-gray-500">Inventory-tracked items — the only type that ever moves stock or carries a cost.</p>
      </div>
      <ProductTabs />
      <ItemsTabs items={itemList} units={units} groups={groups} categories={categories} accounts={revenueAccounts} />
    </div>
  );
}
