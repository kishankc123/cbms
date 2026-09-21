"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, itemUnits, itemGroups, itemCategories, purchaseBills, purchaseReturns, salesInvoices, salesReturns, stockMovements } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export type ItemInput = {
  name: string;
  unitId: string;
  categoryId: string;
  purchasePrice: number;
  sellingPrice: number;
};

export type CreatedItem = { id: string; name: string; purchasePrice: string; sellingPrice: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

// Everything an item form sends is checked here: names are unique (whatever the capitalization), prices can't be negative,
// and the unit and category must be this organization's.
async function checkItem(tenantId: string, input: ItemInput, excludeItemId?: string) {
  const name = input.name.trim();
  if (!name) throw new Error("Item name is required");
  if (name.length > 200) throw new Error("The item name is too long");
  for (const [label, value] of [["purchase price", input.purchasePrice], ["selling price", input.sellingPrice]] as const) {
    if (!Number.isFinite(value || 0) || (value || 0) < 0) throw new Error(`The ${label} can't be negative`);
    if ((value || 0) > 1e12) throw new Error(`The ${label} is too large`);
  }
  if (input.unitId) {
    const [u] = await db.select({ id: itemUnits.id }).from(itemUnits).where(and(eq(itemUnits.id, input.unitId), eq(itemUnits.tenantId, tenantId))).limit(1);
    if (!u) throw new Error("Unit not found");
  }
  if (input.categoryId) {
    const [c] = await db.select({ id: itemCategories.id }).from(itemCategories).where(and(eq(itemCategories.id, input.categoryId), eq(itemCategories.tenantId, tenantId))).limit(1);
    if (!c) throw new Error("Category not found");
  }
  const same = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.tenantId, tenantId), sql`lower(${items.name}) = ${name.toLowerCase()}`, ...(excludeItemId ? [ne(items.id, excludeItemId)] : [])))
    .limit(1);
  if (same.length > 0) throw new Error(`There is already an item called ${name}`);
  return name;
}

export async function createItem(input: ItemInput): Promise<CreatedItem> {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");

  const name = await checkItem(session.tenantId, input);

  let created: typeof items.$inferSelect;
  try {
    [created] = await db
      .insert(items)
      .values({
        tenantId: session.tenantId,
        name,
        unitId: input.unitId || null,
        categoryId: input.categoryId || null,
        purchasePrice: round2(input.purchasePrice || 0).toFixed(2),
        sellingPrice: round2(input.sellingPrice || 0).toFixed(2),
      })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already an item called ${name}`);
    throw e;
  }

  revalidatePath("/inventory/items");
  revalidatePath("/sales");
  revalidatePath("/purchases", "layout");
  return { id: created.id, name: created.name, purchasePrice: created.purchasePrice, sellingPrice: created.sellingPrice };
}

/** Units, groups and categories for the item form (used when it is opened from a sales or purchase screen). */
export async function getItemFormOptions() {
  const session = await requireTenantSession();
  const [units, groups, categories] = await Promise.all([
    db.select({ id: itemUnits.id, name: itemUnits.name }).from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)).orderBy(itemUnits.name),
    db.select({ id: itemGroups.id, name: itemGroups.name }).from(itemGroups).where(eq(itemGroups.tenantId, session.tenantId)).orderBy(itemGroups.name),
    db.select({ id: itemCategories.id, name: itemCategories.name, groupId: itemCategories.groupId }).from(itemCategories).where(eq(itemCategories.tenantId, session.tenantId)).orderBy(itemCategories.name),
  ]);
  return { units, groups, categories };
}

export async function updateItem(input: ItemInput & { itemId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");

  const [existing] = await db.select({ id: items.id }).from(items).where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId))).limit(1);
  if (!existing) throw new Error("Item not found");
  const name = await checkItem(session.tenantId, input, input.itemId);

  try {
    await db
      .update(items)
      .set({
        name,
        unitId: input.unitId || null,
        categoryId: input.categoryId || null,
        purchasePrice: round2(input.purchasePrice || 0).toFixed(2),
        sellingPrice: round2(input.sellingPrice || 0).toFixed(2),
      })
      .where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already an item called ${name}`);
    throw e;
  }

  revalidatePath("/inventory/items");
}

// Something has "happened" to an item once it has stock movements or appears on any sales invoice, purchase bill or
// return (their line items are stored as jsonb, so matched by itemId containment). Such items are kept for the record.
async function itemHistory(tenantId: string, itemId: string): Promise<string | null> {
  const [moved] = await db.select({ id: stockMovements.id }).from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId))).limit(1);
  if (moved) return "stock movements";
  const contains = (col: typeof salesInvoices.lineItems | typeof purchaseBills.lineItems | typeof salesReturns.lineItems | typeof purchaseReturns.lineItems) => sql`${col} @> ${JSON.stringify([{ itemId }])}::jsonb`;
  const [inv] = await db.select({ id: salesInvoices.id }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), contains(salesInvoices.lineItems))).limit(1);
  if (inv) return "sales invoices";
  const [bill] = await db.select({ id: purchaseBills.id }).from(purchaseBills).where(and(eq(purchaseBills.tenantId, tenantId), contains(purchaseBills.lineItems))).limit(1);
  if (bill) return "purchase bills";
  const [sr] = await db.select({ id: salesReturns.id }).from(salesReturns).where(and(eq(salesReturns.tenantId, tenantId), contains(salesReturns.lineItems))).limit(1);
  if (sr) return "sales returns";
  const [pr] = await db.select({ id: purchaseReturns.id }).from(purchaseReturns).where(and(eq(purchaseReturns.tenantId, tenantId), contains(purchaseReturns.lineItems))).limit(1);
  if (pr) return "purchase returns";
  return null;
}

export async function deleteItem(input: { itemId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "delete")) throw new Error("Not permitted");

  const [item] = await db.select().from(items).where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId))).limit(1);
  if (!item) throw new Error("Item not found");
  const history = await itemHistory(session.tenantId, input.itemId);
  if (history) throw new Error(`${item.name} appears in ${history}, so it can't be deleted — mark it inactive instead`);
  if (Number(item.stockQuantity) !== 0 || Number(item.stockValue) !== 0) throw new Error(`${item.name} still has stock on record, so it can't be deleted`);

  await db.delete(items).where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId)));

  revalidatePath("/inventory/items");
}

/** An inactive item is kept for history but no longer offered on new sales, purchases and returns. */
export async function setItemActive(input: { itemId: string; isActive: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const updated = await db.update(items).set({ isActive: input.isActive }).where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId))).returning({ id: items.id });
  if (updated.length === 0) throw new Error("Item not found");
  for (const p of ["/inventory/items", "/sales", "/purchases/stockable", "/return/sales", "/return/purchase"]) revalidatePath(p);
}
