import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { IsoDate } from "@/lib/calendar";
import { balanceSheet } from "./reports";
import { buildBalanceComparison, type AccountInfo, type BalanceSide } from "./pnl-compare-rules";

const at = (iso: string) => new Date(iso + "T00:00:00Z");
const side = (b: Awaited<ReturnType<typeof balanceSheet>>): BalanceSide => ({ assets: b.assets, liabilities: b.liabilities, equity: b.equity, retainedEarnings: b.retainedEarnings });
const EMPTY: BalanceSide = { assets: [], liabilities: [], equity: [], retainedEarnings: 0 };

/** The Balance Sheet as at a date, grouped under the Chart of Accounts groups; with a second date it sets the two side by side. */
export async function comparativeBalanceSheet(tenantId: string, current: IsoDate, previous?: IsoDate) {
  const [cur, prev, rows] = await Promise.all([
    balanceSheet(tenantId, at(current)),
    previous ? balanceSheet(tenantId, at(previous)) : null,
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, subCategory: accounts.subCategory, parentId: accounts.parentAccountId }).from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.category, ["asset", "liability", "equity"]))),
  ]);
  return buildBalanceComparison(new Map<string, AccountInfo>(rows.map((r) => [r.id, r])), side(cur), prev ? side(prev) : EMPTY);
}
