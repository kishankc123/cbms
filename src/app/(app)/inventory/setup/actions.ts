"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { itemUnits, itemGroups, itemCategories, items, inventorySettings } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

const cleanName = (raw: string, label: string) => {
  const name = raw.trim();
  if (!name) throw new Error(`${label} name is required`);
  if (name.length > 120) throw new Error(`The ${label.toLowerCase()} name is too long`);
  return name;
};

// ---- Units ----

async function assertUnitNameFree(tenantId: string, name: string, excludeId?: string) {
  const same = await db.select({ id: itemUnits.id }).from(itemUnits).where(and(eq(itemUnits.tenantId, tenantId), sql`lower(${itemUnits.name}) = ${name.toLowerCase()}`, ...(excludeId ? [ne(itemUnits.id, excludeId)] : []))).limit(1);
  if (same.length > 0) throw new Error(`There is already a unit called ${name}`);
}

export async function createUnit(input: { name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");
  const name = cleanName(input.name, "Unit");
  await assertUnitNameFree(session.tenantId, name);

  try {
    await db.insert(itemUnits).values({ tenantId: session.tenantId, name });
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already a unit called ${name}`);
    throw e;
  }
  revalidatePath("/inventory/setup");
}

export async function updateUnit(input: { unitId: string; name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const name = cleanName(input.name, "Unit");
  await assertUnitNameFree(session.tenantId, name, input.unitId);

  try {
    await db.update(itemUnits).set({ name }).where(and(eq(itemUnits.id, input.unitId), eq(itemUnits.tenantId, session.tenantId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already a unit called ${name}`);
    throw e;
  }
  revalidatePath("/inventory/setup");
}

export async function deleteUnit(input: { unitId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "delete")) throw new Error("Not permitted");

  const [inUse] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.tenantId, session.tenantId), eq(items.unitId, input.unitId)))
    .limit(1);
  if (inUse) throw new Error("This unit is used by an item and cannot be deleted");

  await db.delete(itemUnits).where(and(eq(itemUnits.id, input.unitId), eq(itemUnits.tenantId, session.tenantId)));
  revalidatePath("/inventory/setup");
}

// ---- Groups ----

async function assertGroupNameFree(tenantId: string, name: string, excludeId?: string) {
  const same = await db.select({ id: itemGroups.id }).from(itemGroups).where(and(eq(itemGroups.tenantId, tenantId), sql`lower(${itemGroups.name}) = ${name.toLowerCase()}`, ...(excludeId ? [ne(itemGroups.id, excludeId)] : []))).limit(1);
  if (same.length > 0) throw new Error(`There is already a group called ${name}`);
}

export async function createGroup(input: { name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");
  const name = cleanName(input.name, "Group");
  await assertGroupNameFree(session.tenantId, name);

  try {
    await db.insert(itemGroups).values({ tenantId: session.tenantId, name });
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already a group called ${name}`);
    throw e;
  }
  revalidatePath("/inventory/setup");
}

export async function updateGroup(input: { groupId: string; name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const name = cleanName(input.name, "Group");
  await assertGroupNameFree(session.tenantId, name, input.groupId);

  try {
    await db.update(itemGroups).set({ name }).where(and(eq(itemGroups.id, input.groupId), eq(itemGroups.tenantId, session.tenantId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already a group called ${name}`);
    throw e;
  }
  revalidatePath("/inventory/setup");
}

export async function deleteGroup(input: { groupId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "delete")) throw new Error("Not permitted");

  const [hasCategory] = await db
    .select({ id: itemCategories.id })
    .from(itemCategories)
    .where(and(eq(itemCategories.tenantId, session.tenantId), eq(itemCategories.groupId, input.groupId)))
    .limit(1);
  if (hasCategory) throw new Error("This group has categories under it and cannot be deleted");

  await db.delete(itemGroups).where(and(eq(itemGroups.id, input.groupId), eq(itemGroups.tenantId, session.tenantId)));
  revalidatePath("/inventory/setup");
}

// ---- Categories ----

async function assertCategoryOk(tenantId: string, name: string, groupId: string, excludeId?: string) {
  if (!groupId) throw new Error("Select a group");
  const [group] = await db.select({ id: itemGroups.id }).from(itemGroups).where(and(eq(itemGroups.id, groupId), eq(itemGroups.tenantId, tenantId))).limit(1);
  if (!group) throw new Error("Group not found");
  const same = await db
    .select({ id: itemCategories.id })
    .from(itemCategories)
    .where(and(eq(itemCategories.tenantId, tenantId), eq(itemCategories.groupId, groupId), sql`lower(${itemCategories.name}) = ${name.toLowerCase()}`, ...(excludeId ? [ne(itemCategories.id, excludeId)] : [])))
    .limit(1);
  if (same.length > 0) throw new Error(`There is already a category called ${name} in that group`);
}

export async function createCategory(input: { name: string; groupId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");
  const name = cleanName(input.name, "Category");
  await assertCategoryOk(session.tenantId, name, input.groupId);

  try {
    await db.insert(itemCategories).values({ tenantId: session.tenantId, groupId: input.groupId, name });
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already a category called ${name} in that group`);
    throw e;
  }
  revalidatePath("/inventory/setup");
}

export async function updateCategory(input: { categoryId: string; name: string; groupId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const name = cleanName(input.name, "Category");
  await assertCategoryOk(session.tenantId, name, input.groupId, input.categoryId);

  try {
    await db
      .update(itemCategories)
      .set({ name, groupId: input.groupId })
      .where(and(eq(itemCategories.id, input.categoryId), eq(itemCategories.tenantId, session.tenantId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`There is already a category called ${name} in that group`);
    throw e;
  }
  revalidatePath("/inventory/setup");
}

export async function deleteCategory(input: { categoryId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "delete")) throw new Error("Not permitted");

  const [inUse] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.tenantId, session.tenantId), eq(items.categoryId, input.categoryId)))
    .limit(1);
  if (inUse) throw new Error("This category is used by an item and cannot be deleted");

  await db
    .delete(itemCategories)
    .where(and(eq(itemCategories.id, input.categoryId), eq(itemCategories.tenantId, session.tenantId)));
  revalidatePath("/inventory/setup");
}

// ---- Stock settings ----

export async function updateInventorySettings(input: { allowNegativeStock: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  await db
    .insert(inventorySettings)
    .values({ tenantId: session.tenantId, allowNegativeStock: Boolean(input.allowNegativeStock) })
    .onConflictDoUpdate({ target: inventorySettings.tenantId, set: { allowNegativeStock: Boolean(input.allowNegativeStock) } });
  revalidatePath("/inventory/setup");
}
