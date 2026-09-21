"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { deleteOpening, previewOpeningChange, previewOpeningDate, saveOpening, setOpeningDate } from "@/lib/inventory/opening";
import { rebuildStockBalances, recalculateAll } from "@/lib/inventory/recalc";

function refresh() {
  for (const p of ["/inventory/items", "/inventory/stock", "/journal", "/dashboard", "/chart-of-accounts"]) revalidatePath(p);
}

/** What changing or deleting an item's opening stock would do — nothing is changed. Pass no quantity to preview a deletion. */
export async function previewOpeningStockChange(input: { itemId: string; quantity: number | null; unitCost?: number }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "view")) throw new Error("Not permitted");
  return previewOpeningChange(session.tenantId, input);
}

export async function saveOpeningStock(input: { itemId: string; quantity: number; unitCost: number; reason?: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "create")) throw new Error("Not permitted");
  await saveOpening(session.tenantId, session.userId, input);
  refresh();
}

export async function deleteOpeningStock(input: { itemId: string; reason?: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "delete")) throw new Error("Not permitted");
  await deleteOpening(session.tenantId, session.userId, input);
  refresh();
}

/** What setting the Inventory Opening Date to this day would affect — nothing is changed. */
export async function previewInventoryOpeningDate(date: string) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "view")) throw new Error("Not permitted");
  return previewOpeningDate(session.tenantId, date);
}

export async function changeInventoryOpeningDate(input: { date: string; reason?: string; confirmed: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  await setOpeningDate(session.tenantId, session.userId, input);
  refresh();
  revalidatePath("/", "layout");
}

/** Re-costs every item's history in date order and books any difference. Safe to run again. */
export async function recalculateInventory() {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const result = await recalculateAll(session.tenantId, { userId: session.userId, reason: "Recalculated by request" });
  refresh();
  return result;
}

/** Sets any item whose stored quantity or value no longer matches its movements back to what they add up to. */
export async function rebuildInventoryBalances() {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const fixed = await rebuildStockBalances(session.tenantId, session.userId);
  refresh();
  return { fixed };
}
