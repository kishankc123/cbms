"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, purchaseBills } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export type ItemInput = {
  name: string;
  unitId: string;
  categoryId: string;
  purchasePrice: number;
  sellingPrice: number;
};

export async function createItem(input: ItemInput) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");

  const name = input.name.trim();
  if (!name) throw new Error("Item name is required");

  await db.insert(items).values({
    tenantId: session.tenantId,
    name,
    unitId: input.unitId || null,
    categoryId: input.categoryId || null,
    purchasePrice: (input.purchasePrice || 0).toFixed(2),
    sellingPrice: (input.sellingPrice || 0).toFixed(2),
  });

  revalidatePath("/inventory/items");
}

export async function updateItem(input: ItemInput & { itemId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");

  const name = input.name.trim();
  if (!name) throw new Error("Item name is required");

  await db
    .update(items)
    .set({
      name,
      unitId: input.unitId || null,
      categoryId: input.categoryId || null,
      purchasePrice: (input.purchasePrice || 0).toFixed(2),
      sellingPrice: (input.sellingPrice || 0).toFixed(2),
    })
    .where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId)));

  revalidatePath("/inventory/items");
}

// An item is "used" once it appears in any Stockable purchase invoice's line
// items (stored as jsonb, so no FK to enforce this) — matched by itemId
// containment in that jsonb array. Used items are kept for audit history.
export async function deleteItem(input: { itemId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "delete")) throw new Error("Not permitted");

  const [inUse] = await db
    .select({ id: purchaseBills.id })
    .from(purchaseBills)
    .where(
      and(
        eq(purchaseBills.tenantId, session.tenantId),
        sql`${purchaseBills.lineItems} @> ${JSON.stringify([{ itemId: input.itemId }])}::jsonb`
      )
    )
    .limit(1);
  if (inUse) throw new Error("This item has purchase history and cannot be deleted");

  await db.delete(items).where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId)));

  revalidatePath("/inventory/items");
}
