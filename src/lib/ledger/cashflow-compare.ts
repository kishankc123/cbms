import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { DateRange } from "@/lib/calendar";
import { cashFlowStatement } from "./reports";
import { buildCashFlowComparison, EMPTY_PERIOD, rollUpToGroups, type GroupOf } from "./cashflow-compare-rules";

const at = (iso: string) => new Date(iso + "T00:00:00Z");

/** The cash flow statement for a period; with a second period it sets the two side by side. Customers, suppliers and other sub-accounts show as their group. */
export async function comparativeCashFlow(tenantId: string, current: DateRange, previous?: DateRange) {
  const [cur, prev, rows] = await Promise.all([
    cashFlowStatement(tenantId, at(current.from), at(current.to)),
    previous ? cashFlowStatement(tenantId, at(previous.from), at(previous.to)) : EMPTY_PERIOD,
    db.select({ id: accounts.id, name: accounts.name, category: accounts.category, parentId: accounts.parentAccountId }).from(accounts).where(eq(accounts.tenantId, tenantId)),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Only balance sheet accounts roll up: the depreciation and disposal lines belong to expense and income accounts and keep their own names.
  const groupOf: GroupOf = (id) => {
    const a = byId.get(id);
    const g = a && a.category !== "income" && a.category !== "expense" && a.parentId ? byId.get(a.parentId) : null;
    return g ? { id: g.id, name: g.name } : null;
  };
  return buildCashFlowComparison(rollUpToGroups(cur, groupOf), rollUpToGroups(prev, groupOf));
}
