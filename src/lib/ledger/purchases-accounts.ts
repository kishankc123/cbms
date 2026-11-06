import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { findControlAccount } from "./control-accounts";

// Where an organization that does not track inventory books what it buys: a Purchases expense account under Direct expenses, with any
// sub-accounts the organization adds under it (Purchases - Raw material, ...). It is deliberately NOT under Cost of Goods Sold: with no
// stock, nothing is costed, so purchases are an expense of the period and no COGS figure is produced.

export const PURCHASES_CODE = "5050";
const NAME = "Purchases";

export async function getOrCreatePurchasesAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, [PURCHASES_CODE], NAME);
  if (existing) return existing;
  const [created] = await db.insert(accounts).values({ tenantId, code: PURCHASES_CODE, name: NAME, category: "expense", subCategory: "Direct expenses" }).returning();
  return created;
}

export const PENDING_PURCHASES_CODE = "1210";

/**
 * Where a stockable purchase waits when it was recorded by its amount and the items are still to be added: a current asset, not Inventory, so the
 * ledger's Inventory always equals the stock's value. Adding the items moves the amount from here into Inventory.
 */
export async function getOrCreatePendingPurchasesAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, [PENDING_PURCHASES_CODE], "Purchases awaiting item details");
  if (existing) return existing;
  const [created] = await db.insert(accounts).values({ tenantId, code: PENDING_PURCHASES_CODE, name: "Purchases awaiting item details", category: "asset", subCategory: "Current assets" }).returning();
  return created;
}

/** The Purchases account and its sub-accounts, for a purchase bill's category. Empty until the account exists. */
export async function getPurchaseCategories(tenantId: string) {
  const [root] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, PURCHASES_CODE))).limit(1);
  if (!root) return [];
  const children = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, root.id), eq(accounts.isActive, true))).orderBy(accounts.code);
  return [{ id: root.id, code: root.code, name: root.name }, ...children];
}
