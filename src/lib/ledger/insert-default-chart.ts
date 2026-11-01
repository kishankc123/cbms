import type { db } from "@/db";
import { accounts } from "@/db/schema";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./default-chart-of-accounts";

/**
 * Puts the standard chart into a new organization: the groups first, then the accounts inside them. A TDS heading is linked only if the
 * organization's country offers it (`activeHeads`), so a country without Rent TDS simply gets no link.
 */
export async function insertDefaultChart(tx: Pick<typeof db, "insert">, tenantId: string, activeHeads: ReadonlySet<string>) {
  const row = (a: (typeof DEFAULT_CHART_OF_ACCOUNTS)[number], parentAccountId: string | null = null) => ({
    tenantId,
    code: a.code,
    name: a.name,
    category: a.category,
    subCategory: a.subCategory,
    parentAccountId,
    tdsHeadKey: a.tdsHead && activeHeads.has(a.tdsHead) ? a.tdsHead : null,
  });
  const top = await tx.insert(accounts).values(DEFAULT_CHART_OF_ACCOUNTS.filter((a) => !a.parentCode).map((a) => row(a))).returning({ id: accounts.id, code: accounts.code });
  const idOf = new Map(top.map((t) => [t.code, t.id]));
  const inside = DEFAULT_CHART_OF_ACCOUNTS.filter((a) => a.parentCode);
  if (inside.length) await tx.insert(accounts).values(inside.map((a) => row(a, idOf.get(a.parentCode!)!)));
}
