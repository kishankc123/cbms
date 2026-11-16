import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { DateRange } from "@/lib/calendar";
import { profitAndLoss } from "./reports";
import { buildComparison, type AccountInfo } from "./pnl-compare-rules";

const at = (iso: string) => new Date(iso + "T00:00:00Z");

/** Profit & Loss for a period, grouped under the Chart of Accounts groups; with a second period it sets the two side by side. */
export async function comparativeProfitAndLoss(tenantId: string, current: DateRange, previous?: DateRange) {
  const [cur, prev, rows] = await Promise.all([
    profitAndLoss(tenantId, at(current.from), at(current.to)),
    previous ? profitAndLoss(tenantId, at(previous.from), at(previous.to)) : { income: [], expenses: [] },
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, subCategory: accounts.subCategory, parentId: accounts.parentAccountId }).from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.category, ["income", "expense"]))),
  ]);
  const infos = new Map<string, AccountInfo>(rows.map((r) => [r.id, r]));
  return buildComparison(infos, cur, prev);
}
