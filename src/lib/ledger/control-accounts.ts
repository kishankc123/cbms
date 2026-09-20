import { and, eq, inArray, ilike } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { insertChildAccount } from "./chart";

/**
 * Locates a tenant's control account (e.g. Accounts Receivable, Tax Payable) by
 * chart-of-accounts code first (matches the default template), falling back to
 * a name search for tenants who customized their codes.
 */
export async function findControlAccount(tenantId: string, codes: string[], nameLike: string) {
  const [byCode] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.code, codes)))
    .limit(1);
  if (byCode) return byCode;

  const [byName] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), ilike(accounts.name, `%${nameLike}%`)))
    .limit(1);
  return byName ?? null;
}

/**
 * The equity account customer/supplier opening balances post against —
 * the "Brought forward" figure representing balances carried in from before
 * the books started, so opening balances participate in the trial balance
 * instead of being an off-ledger display-only number.
 */
export async function getOrCreateBroughtForwardAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["3200"], "Brought forward");
  if (existing) return existing;

  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "3200", name: "Brought forward", category: "equity", subCategory: "Equity & reserve" })
    .returning();
  return created;
}

/**
 * Creates a child account nested under `parent` — mirrors Chart of
 * Accounts > Sub-group's own scheme (parent code + sequence, category and
 * subCategory copied down from the parent). Shared by every place that
 * needs one sub-account per record (employees under Salary Payable,
 * customers under Accounts Receivable, suppliers under Accounts Payable).
 */
export async function createSubAccount(
  tenantId: string,
  parent: { id: string; code: string; category: (typeof accounts.$inferSelect)["category"]; subCategory: string | null },
  name: string
) {
  // Next free code = highest existing sequence + 1 (never reused after a delete).
  const created = await insertChildAccount(tenantId, { ...parent, code: parent.code }, { name });
  return created;
}

/**
 * Sub-groups under the tenant's "Cost of Goods Sold" group account — used as
 * the Category options on purchase bills. Returns [] if the group has no
 * sub-groups yet (set up under Chart of Accounts > Sub-group).
 */
export async function getCogsSubGroups(tenantId: string) {
  const cogs = await findControlAccount(tenantId, ["5000"], "Cost of Goods Sold");
  if (!cogs) return [];

  return db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, cogs.id)))
    .orderBy(accounts.code);
}
