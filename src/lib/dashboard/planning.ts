import { and, asc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, plannedEvents, vendors } from "@/db/schema";
import { cashFlow } from "./cash-flow";
import { addDays, loadForecast, type ForecastResult } from "./forecast";
import type { EventCategory, PaymentPattern, PlannedEvent, SalesEffect, Urgency } from "./planning-rules";

export * from "./planning-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Events still being planned, soonest first. Done and cancelled ones are kept in the table but not tried against the forecast. */
export async function listPlannedEvents(tenantId: string): Promise<PlannedEvent[]> {
  const rows = await db
    .select({ e: plannedEvents, vendorName: vendors.name })
    .from(plannedEvents)
    .leftJoin(vendors, eq(vendors.id, plannedEvents.vendorId))
    .where(and(eq(plannedEvents.tenantId, tenantId), eq(plannedEvents.status, "planned")))
    .orderBy(asc(plannedEvents.plannedDate));
  return rows.map(({ e, vendorName }) => ({
    id: e.id,
    name: e.name,
    category: e.category as EventCategory,
    vendorId: e.vendorId,
    vendorName,
    estimate: num(e.estimate),
    low: numOrNull(e.low),
    high: numOrNull(e.high),
    earliestDate: e.earliestDate,
    latestDate: e.latestDate,
    plannedDate: e.plannedDate,
    pattern: e.pattern as PaymentPattern,
    advancePct: e.advancePct,
    balanceDays: e.balanceDays,
    instalments: e.instalments,
    intervalDays: e.intervalDays,
    creditDays: e.creditDays,
    urgency: e.urgency as Urgency,
    salesEffect: e.salesEffect as SalesEffect,
    salesEffectMonthly: numOrNull(e.salesEffectMonthly),
    salesEffectDays: e.salesEffectDays,
    status: "planned",
    notes: e.notes,
  }));
}

export type CostShares = {
  /** Of each rupee of sales, the part that goes on the cost of what is sold. */
  variableCostShare: number;
  /** Of each rupee of sales, the part that has actually been collected. */
  collectedShare: number;
  basis: { revenue: number; costOfSales: number; collected: number; days: number };
};

/**
 * Starting points for "how much more selling would it take", from the last 90 days: the cost of goods sold against income, and the
 * customer receipts against income. They are only starting points; the owner can change both on the page.
 */
export async function costShares(tenantId: string, today: string): Promise<CostShares> {
  const days = 90;
  const from = addDays(today, -(days - 1));
  const [rows, flow] = await Promise.all([
    db
      .select({ category: accounts.category, code: accounts.code, debit: sql<string>`sum(${journalLines.debitAmount})`, credit: sql<string>`sum(${journalLines.creditAmount})` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(and(eq(journalEntries.tenantId, tenantId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, today), or(eq(accounts.category, "income"), eq(accounts.code, "5000"), like(accounts.code, "5000.%")))!)
      .groupBy(accounts.category, accounts.code),
    cashFlow(tenantId, from, today),
  ]);

  let revenue = 0;
  let costOfSales = 0;
  for (const r of rows) {
    if (r.category === "income") revenue += num(r.credit) - num(r.debit);
    else costOfSales += num(r.debit) - num(r.credit);
  }
  const collected = flow.categories.find((c) => c.key === "customer_collections")?.amount ?? 0;
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
  return {
    variableCostShare: revenue > 0 ? round2(clamp(costOfSales / revenue, 0, 0.95)) : 0.6,
    collectedShare: revenue > 0 ? round2(clamp(collected / revenue, 0.3, 1)) : 0.9,
    basis: { revenue: round2(revenue), costOfSales: round2(costOfSales), collected: round2(collected), days },
  };
}

export type PlanningData = { base: ForecastResult; events: PlannedEvent[]; shares: CostShares };

export async function loadPlanning(tenantId: string, today: string, horizonDays: number): Promise<PlanningData> {
  const [base, events, shares] = await Promise.all([loadForecast(tenantId, today, horizonDays), listPlannedEvents(tenantId), costShares(tenantId, today)]);
  return { base, events, shares };
}

export async function vendorChoices(tenantId: string) {
  const rows = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)).orderBy(asc(vendors.name)).limit(500);
  return rows;
}
