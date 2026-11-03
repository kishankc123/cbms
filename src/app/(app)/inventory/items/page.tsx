import { guardView } from "@/components/page-guard";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits, itemGroups, itemCategories } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { ProductTabs } from "../product-tabs";
import { ItemsTabs } from "./items-tabs";
import { listRevenueAccountOptions } from "./actions";

export default async function ItemsPage() {
  const denied = await guardView("inventory");
  if (denied) return denied;
  const session = await requireTenantSession();

  const [itemList, units, groups, categories, revenueAccounts] = await Promise.all([
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.itemType, "product"))).orderBy(asc(items.name)),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(asc(itemUnits.name)),
    db.select().from(itemGroups).where(eq(itemGroups.tenantId, session.tenantId)).orderBy(asc(itemGroups.name)),
    db.select().from(itemCategories).where(eq(itemCategories.tenantId, session.tenantId)).orderBy(asc(itemCategories.name)),
    listRevenueAccountOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Product" description="Inventory-tracked items — the only type that ever moves stock or carries a cost." className="!mb-0" />
      <ProductTabs />
      <ItemsTabs items={itemList} units={units} groups={groups} categories={categories} accounts={revenueAccounts} />
    </div>
  );
}
