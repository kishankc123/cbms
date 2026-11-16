import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { DateRange } from "@/lib/calendar";
import { profitAndLoss } from "./reports";
import type { AccountInfo } from "./pnl-compare-rules";
import { buildSeries } from "./pnl-series-rules";

const at = (iso: string) => new Date(iso + "T00:00:00Z");

/** Profit & Loss for several periods at once, one column each, grouped under the Chart of Accounts groups. */
export async function seriesProfitAndLoss(tenantId: string, periods: DateRange[]) {
  const [results, rows] = await Promise.all([
    Promise.all(periods.map((p) => profitAndLoss(tenantId, at(p.from), at(p.to)))),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, subCategory: accounts.subCategory, parentId: accounts.parentAccountId }).from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.category, ["income", "expense"]))),
  ]);
  return buildSeries(new Map<string, AccountInfo>(rows.map((r) => [r.id, r])), results);
}
