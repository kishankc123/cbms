import { and, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { addMonths, type CalendarSystem } from "@/lib/calendar";
import { getInventorySettings } from "@/lib/inventory/stock";
import { buildPerformance, lastYearRange, previousRange, type DayAmounts, type PerformanceView } from "./performance-rules";

export * from "./performance-rules";

const num = (v: string | number | null | undefined) => Number(v ?? 0);

export type Performance = PerformanceView & {
  /** Whether the Cost of goods sold card is shown: only for an organization that keeps stock and has posted some. */
  showCogs: boolean;
  trackInventory: boolean;
  stockLossesInCogs: boolean;
};

/** The accounts that make up cost of goods sold: Cost of Goods Sold itself and everything under it, plus (when asked for) stock written off. */
async function cogsAccountIds(tenantId: string, includeStockLosses: boolean): Promise<string[]> {
  const rows = await db
    .select({ id: accounts.id, code: accounts.code, parent: accounts.parentAccountId })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), or(eq(accounts.code, "5000"), like(accounts.code, "5000.%"), ...(includeStockLosses ? [eq(accounts.code, "5920")] : []))));
  const root = rows.find((r) => r.code === "5000");
  const underRoot = root ? await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, root.id))) : [];
  return [...new Set([...rows.map((r) => r.id), ...underRoot.map((r) => r.id)])];
}

/**
 * Revenue, cost of goods sold and other expenses by day, from the ledger, for the period, the period before, the same period a year ago and the
 * last twelve months (whichever reaches furthest back): one grouped query, then the rules work out the comparisons and the expectation.
 * An organization that keeps no stock has no cost of goods sold: anything older posted there is counted with the other expenses, so profit
 * stays right, and the card is not shown.
 */
export async function loadPerformance(tenantId: string, range: { from: string; to: string }, calendar: CalendarSystem, today: string): Promise<Performance> {
  const settings = await getInventorySettings(tenantId);
  const cogsIds = await cogsAccountIds(tenantId, settings.trackInventory && settings.overviewStockLossesInCogs);

  const anchor = range.to < today ? range.to : today;
  const earliest = [previousRange(range.from, range.to).from, lastYearRange(range.from, range.to, calendar).from, addMonths(calendar, anchor, -13)].sort()[0];
  const latest = range.to;

  const isCogs = cogsIds.length > 0 ? inArray(accounts.id, cogsIds) : sql`false`;
  const cls = sql<string>`case when ${accounts.category} = 'income' then 'revenue' when ${isCogs} then 'cogs' else 'expense' end`;
  const grouped = await db
    .select({ day: journalEntries.entryDate, cls, debit: sql<string>`sum(${journalLines.debitAmount})`, credit: sql<string>`sum(${journalLines.creditAmount})` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalEntries.tenantId, tenantId), gte(journalEntries.entryDate, earliest), lte(journalEntries.entryDate, latest), inArray(accounts.category, ["income", "expense"])))
    .groupBy(sql`1`, sql`2`);

  const byDay = new Map<string, DayAmounts>();
  for (const g of grouped) {
    const d = byDay.get(g.day) ?? { day: g.day, revenue: 0, cogs: 0, expenses: 0 };
    if (g.cls === "revenue") d.revenue += num(g.credit) - num(g.debit);
    else if (g.cls === "cogs") d.cogs += num(g.debit) - num(g.credit);
    else d.expenses += num(g.debit) - num(g.credit);
    byDay.set(g.day, d);
  }
  let rows = [...byDay.values()];
  if (!settings.trackInventory) rows = rows.map((r) => ({ ...r, expenses: r.expenses + r.cogs, cogs: 0 }));

  const view = buildPerformance({ rows, from: range.from, to: range.to, today, calendar });
  const showCogs = settings.trackInventory && rows.some((r) => Math.abs(r.cogs) > 0.004);
  return { ...view, showCogs, trackInventory: settings.trackInventory, stockLossesInCogs: settings.overviewStockLossesInCogs };
}

