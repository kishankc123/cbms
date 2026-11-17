import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, accounts } from "@/db/schema";
import { SYSTEM_ACCOUNT_CODES } from "./chart-rules";
import { settlementAccounts, type SettlementAccount } from "./settlement-rules";

/** The ledger accounts (other than cash and bank) a payment can be settled through. See settlement-rules.ts for which. */
export async function listSettlementAccounts(tenantId: string): Promise<SettlementAccount[]> {
  const [rows, roles] = await Promise.all([
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, category: accounts.category, parentId: accounts.parentAccountId, isActive: accounts.isActive }).from(accounts).where(eq(accounts.tenantId, tenantId)),
    db.select({ id: accountRoles.accountId }).from(accountRoles).where(eq(accountRoles.tenantId, tenantId)),
  ]);
  return settlementAccounts(rows, new Set(roles.map((r) => r.id)), SYSTEM_ACCOUNT_CODES);
}
