import { and, eq, or, like } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";

export type CashBankGroup = {
  id: string;
  code: string;
  name: string;
  children: { id: string; code: string; name: string }[];
};

/**
 * Cash and Bank accounts (the "1000 Cash" group and everything under "1010
 * Bank", including its sub-groups like individual bank accounts) — the set of
 * accounts a payment can be received into, organized by group so a group with
 * sub-groups can be shown as a locked heading over its selectable sub-groups.
 */
export async function getCashBankAccounts(tenantId: string): Promise<CashBankGroup[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.tenantId, tenantId),
        eq(accounts.isActive, true),
        or(eq(accounts.code, "1000"), like(accounts.code, "1010%"))
      )
    )
    .orderBy(accounts.code);

  const groups: CashBankGroup[] = [];
  const groupByCode = new Map<string, CashBankGroup>();

  for (const row of rows) {
    if (!row.code.includes(".")) {
      const group: CashBankGroup = { id: row.id, code: row.code, name: row.name, children: [] };
      groups.push(group);
      groupByCode.set(row.code, group);
    }
  }
  for (const row of rows) {
    if (!row.code.includes(".")) continue;
    const parentCode = row.code.split(".")[0];
    groupByCode.get(parentCode)?.children.push({ id: row.id, code: row.code, name: row.name });
  }

  return groups;
}
