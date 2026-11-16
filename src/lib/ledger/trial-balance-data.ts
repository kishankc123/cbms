import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { addDays, type DateRange } from "@/lib/calendar";
import { accountBalancesAsOf } from "./reports";
import { buildTrialBalance, type Totals } from "./trial-balance-rules";
import type { AccountInfo } from "./pnl-compare-rules";

const at = (iso: string) => new Date(iso + "T00:00:00Z");
const totals = (rows: Awaited<ReturnType<typeof accountBalancesAsOf>>): Totals[] => rows.map((r) => ({ accountId: r.accountId, debit: r.debitTotal, credit: r.creditTotal }));

/** The trial balance grouped under the Chart of Accounts groups. With a period: opening, movement and closing. With only a date: balances as at it. */
export async function loadTrialBalance(tenantId: string, period: DateRange | { to: string; from?: undefined }) {
  const [rows, closing, opening] = await Promise.all([
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, subCategory: accounts.subCategory, parentId: accounts.parentAccountId, category: accounts.category }).from(accounts).where(eq(accounts.tenantId, tenantId)),
    accountBalancesAsOf(tenantId, at(period.to)),
    // An opening balance entered on the first day of the period counts as the balance brought in, not as a movement.
    period.from ? accountBalancesAsOf(tenantId, at(addDays(period.from, -1)), period.from) : Promise.resolve([]),
  ]);
  return buildTrialBalance(new Map<string, AccountInfo>(rows.map((r) => [r.id, r])), totals(opening), totals(closing));
}
