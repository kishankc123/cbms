import { and, eq, inArray, ilike } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";

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
