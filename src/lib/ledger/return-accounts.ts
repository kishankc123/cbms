import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { findControlAccount } from "./control-accounts";

/**
 * The Chart of Accounts entry sales returns post to (4050 Sales Returns, a contra-revenue account under
 * Revenue, so gross sales stay visible). Organizations created before it existed get it added on first use.
 */
export async function ensureSalesReturnsAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["4050"], "Sales Returns");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "4050", name: "Sales Returns", category: "income", subCategory: "Revenue" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, "4050"))).limit(1);
  return row;
}
