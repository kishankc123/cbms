import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, ne, notExists } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, accounts, items } from "@/db/schema";
import { findControlAccount } from "@/lib/ledger/control-accounts";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type RevenueLine = { itemId: string | null | undefined; amount: number };

/**
 * Groups invoice-line taxable amounts by the revenue account each resolves to: an item's own configured
 * account if it has one, else the tenant's default Sales Revenue control account. Returns one {accountId,
 * amount} per distinct account — never a single aggregate line — so an invoice mixing, say, a Product
 * posting to Sales Revenue and a Service posting to Service Revenue posts to both correctly in the same
 * entry. The account must never be inferred from item type (a Service without its own override still
 * falls back to the shared default, same as a Product would) — only from what's actually configured.
 */
export async function resolveRevenueLines(tenantId: string, lines: RevenueLine[]): Promise<{ accountId: string; amount: number }[]> {
  const real = lines.filter((l) => round2(l.amount) !== 0);
  if (real.length === 0) return [];

  const itemIds = [...new Set(real.map((l) => l.itemId).filter((id): id is string => Boolean(id)))];
  const overrides = new Map<string, string>();
  if (itemIds.length > 0) {
    const rows = await db.select({ id: items.id, revenueAccountId: items.revenueAccountId }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
    for (const r of rows) if (r.revenueAccountId) overrides.set(r.id, r.revenueAccountId);
  }

  const needsDefault = real.some((l) => !l.itemId || !overrides.has(l.itemId));
  let defaultId: string | null = null;
  if (needsDefault) {
    const defaultAccount = await findControlAccount(tenantId, ["4000"], "Sales Revenue");
    if (!defaultAccount) throw new Error("No Sales Revenue account found — add one to the Chart of Accounts first");
    defaultId = defaultAccount.id;
  }

  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const l of real) {
    const accountId = (l.itemId && overrides.get(l.itemId)) || defaultId!;
    if (!totals.has(accountId)) {
      totals.set(accountId, 0);
      order.push(accountId);
    }
    totals.set(accountId, round2(totals.get(accountId)! + l.amount));
  }
  return order.map((accountId) => ({ accountId, amount: totals.get(accountId)! }));
}

/**
 * The accounts an invoice can be booked to: active income accounts at the LOWEST level only — a revenue group that has
 * sub-groups can't be chosen itself, only its sub-groups can. Sales Returns (a deduction) and the gain on asset disposals
 * (the Assets module posts that itself) are not revenue to pick.
 */
export async function getRevenueAccounts(tenantId: string) {
  const child = alias(accounts, "child");
  const parent = alias(accounts, "parent");
  const rows = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, parentCode: parent.code, parentName: parent.name })
    .from(accounts)
    .leftJoin(parent, eq(parent.id, accounts.parentAccountId))
    .where(
      and(
        eq(accounts.tenantId, tenantId),
        eq(accounts.isActive, true),
        eq(accounts.category, "income"),
        ne(accounts.code, "4050"),
        notExists(db.select({ one: accountRoles.id }).from(accountRoles).where(and(eq(accountRoles.accountId, accounts.id), inArray(accountRoles.roleKey, ["asset_disposal_gain"])))),
        notExists(db.select({ one: child.id }).from(child).where(and(eq(child.parentAccountId, accounts.id), eq(child.isActive, true))))
      )
    )
    .orderBy(accounts.code);
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, group: r.parentCode ? `${r.parentCode} — ${r.parentName}` : null }));
}

/** The account id when it is one of this organization's selectable revenue accounts; otherwise an error the person can act on. */
export async function assertRevenueAccount(tenantId: string, accountId: string): Promise<string> {
  const ok = (await getRevenueAccounts(tenantId)).some((a) => a.id === accountId);
  if (!ok) throw new Error("Choose a revenue account of this organization (a group that has sub-groups can't be chosen).");
  return accountId;
}
