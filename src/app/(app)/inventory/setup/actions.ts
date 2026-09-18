"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { itemUnits, itemGroups, itemCategories, items } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

// ---- Units ----

export async function createUnit(input: { name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");
  const name = input.name.trim();
  if (!name) throw new Error("Unit name is required");

  await db.insert(itemUnits).values({ tenantId: session.tenantId, name });
  revalidatePath("/inventory/setup");
}

export async function updateUnit(input: { unitId: string; name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const name = input.name.trim();
  if (!name) throw new Error("Unit name is required");

  await db
    .update(itemUnits)
    .set({ name })
    .where(and(eq(itemUnits.id, input.unitId), eq(itemUnits.tenantId, session.tenantId)));
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

export async function createGroup(input: { name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");
  const name = input.name.trim();
  if (!name) throw new Error("Group name is required");

  await db.insert(itemGroups).values({ tenantId: session.tenantId, name });
  revalidatePath("/inventory/setup");
}

export async function updateGroup(input: { groupId: string; name: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const name = input.name.trim();
  if (!name) throw new Error("Group name is required");

  await db
    .update(itemGroups)
    .set({ name })
    .where(and(eq(itemGroups.id, input.groupId), eq(itemGroups.tenantId, session.tenantId)));
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

export async function createCategory(input: { name: string; groupId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");
  const name = input.name.trim();
  if (!name) throw new Error("Category name is required");
  if (!input.groupId) throw new Error("Select a group");

  await db.insert(itemCategories).values({ tenantId: session.tenantId, groupId: input.groupId, name });
  revalidatePath("/inventory/setup");
}

export async function updateCategory(input: { categoryId: string; name: string; groupId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const name = input.name.trim();
  if (!name) throw new Error("Category name is required");
  if (!input.groupId) throw new Error("Select a group");

  await db
    .update(itemCategories)
    .set({ name, groupId: input.groupId })
    .where(and(eq(itemCategories.id, input.categoryId), eq(itemCategories.tenantId, session.tenantId)));
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
