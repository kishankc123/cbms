"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export async function createItem(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const defaultRate = parseFloat(String(formData.get("defaultRate") ?? "0")) || 0;
  if (!name) throw new Error("Item name is required");

  await db.insert(items).values({
    tenantId: session.tenantId,
    name,
    unit: unit || null,
    defaultRate: defaultRate.toFixed(2),
  });

  revalidatePath("/inventory/items");
}

export async function deleteItem(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "delete")) throw new Error("Not permitted");

  const itemId = String(formData.get("itemId"));
  await db.delete(items).where(and(eq(items.id, itemId), eq(items.tenantId, session.tenantId)));

  revalidatePath("/inventory/items");
}
