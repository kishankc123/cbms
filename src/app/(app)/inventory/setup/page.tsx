import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { itemUnits, itemGroups, itemCategories } from "@/db/schema";
import { getAllowNegativeStock } from "@/lib/inventory/stock";
import { requireTenantSession } from "@/lib/session";
import { SetupTabs } from "./setup-tabs";

export default async function InventorySetupPage() {
  const session = await requireTenantSession();

  const [units, groups, categories, allowNegativeStock] = await Promise.all([
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(asc(itemUnits.name)),
    db.select().from(itemGroups).where(eq(itemGroups.tenantId, session.tenantId)).orderBy(asc(itemGroups.name)),
    db.select().from(itemCategories).where(eq(itemCategories.tenantId, session.tenantId)).orderBy(asc(itemCategories.name)),
    getAllowNegativeStock(session.tenantId),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Inventory setup</h1>
      <SetupTabs units={units} groups={groups} categories={categories} allowNegativeStock={allowNegativeStock} />
    </div>
  );
}
