import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
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
