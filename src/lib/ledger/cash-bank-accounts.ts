import { alias } from "drizzle-orm/pg-core";
import { and, eq, or, like } from "drizzle-orm";
import { db } from "@/db";
import { accounts, paymentModeAccounts } from "@/db/schema";

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
 * Accounts linked to a payment mode (a Fonepay or wallet account, say) count too, wherever they sit in the chart, so every
 * balance, report and check that works from this list sees them.
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

  // Accounts linked to a payment mode that sit outside Cash and Bank, each under its own group.
  const parent = alias(accounts, "parent");
  const linked = await db
    .selectDistinct({ id: accounts.id, code: accounts.code, name: accounts.name, parentId: parent.id, parentCode: parent.code, parentName: parent.name })
    .from(paymentModeAccounts)
    .innerJoin(accounts, eq(accounts.id, paymentModeAccounts.accountId))
    .leftJoin(parent, eq(parent.id, accounts.parentAccountId))
    .where(and(eq(paymentModeAccounts.tenantId, tenantId), eq(accounts.isActive, true)))
    .orderBy(accounts.code);
  const have = new Set(rows.map((r) => r.id));
  for (const a of linked) {
    if (have.has(a.id)) continue;
    if (a.parentId && a.parentCode) {
      let g = groups.find((x) => x.id === a.parentId);
      if (!g) {
        g = { id: a.parentId, code: a.parentCode, name: a.parentName ?? "", children: [] };
        groups.push(g);
      }
      g.children.push({ id: a.id, code: a.code, name: a.name });
    } else {
      groups.push({ id: a.id, code: a.code, name: a.name, children: [] });
    }
  }

  return groups;
}
