import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, paymentAllocations, payments, tenants } from "@/db/schema";
import { todayIso } from "@/lib/calendar";
import { getPenaltyRule } from "./penalty-rules";
import type { TdsPenaltyParams } from "./penalty-engine";
import { tdsFinesByHeading, tranchesFor, type Tranche } from "./tds-fines";
import { NOT_ASSIGNED, tdsDepositBreakdown, tdsHeadNames, tdsWithheldLines } from "./tds-by-heading";
import { depositStatus, positionByHeading, uncoveredRows, type DepositMonthRow, type TdsDepositPosition } from "./tds-deposit-rules";
export type { TdsDepositPosition } from "./tds-deposit-rules";

/**
 * TDS withheld against TDS deposited, for every deposit period (compliance item) that overlaps the range, by heading. A deposit counts for the
 * period it pays for, not the day the money moved. TDS withheld in a month nobody has a deposit item for is listed too, as "no deposit item".
 * `onlyHeadKey` limits it to one heading (payroll's own report asks for its salary heading).
 */
export async function tdsDepositPosition(tenantId: string, from: string, to: string, onlyHeadKey?: string | null, asOf: string = todayIso()): Promise<TdsDepositPosition> {
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const names = await tdsHeadNames(tenantId);
  const nameOf = (key: string | null) => (key ? names.get(key) ?? key : NOT_ASSIGNED);
  const keep = (key: string | null) => onlyHeadKey === undefined || key === onlyHeadKey;

  const obligations = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.taxTypeKey, "tds"), ne(complianceObligations.status, "not_applicable"), lte(complianceObligations.periodStart, to), gte(complianceObligations.periodEnd, from)))
    .orderBy(asc(complianceObligations.periodStart));

  const rows: DepositMonthRow[] = [];
  const basis = { asOf, missingRule: false, unverified: false };
  for (const ob of obligations) {
    if (!ob.periodStart || !ob.periodEnd) continue;
    const breakdown = await tdsDepositBreakdown(tenantId, ob);
    // Fines are worked out across every heading of the item (the flat daily fine is shared between them), then limited to the headings asked for.
    const rule = await getPenaltyRule(tenant?.countryCode ?? "", "tds", ob.dueDate);
    if (!rule) basis.missingRule = true;
    else if (!rule.isVerified) basis.unverified = true;
    const dates = await depositDates(tenantId, ob.id);
    const fines = rule ? tdsFinesByHeading(breakdown.map((b) => ({ key: b.key, tranches: tranchesFor(b.withheld, dates.get(b.key) ?? [], asOf) })), ob.dueDate, rule.params as TdsPenaltyParams) : null;
    for (const b of breakdown) {
      if (!keep(b.key)) continue;
      rows.push({ obligationId: ob.id, period: ob.periodLabel ?? ob.name, periodStart: ob.periodStart, periodEnd: ob.periodEnd, headKey: b.key, heading: b.name, withheld: b.withheld, deposited: b.deposited, remaining: b.remaining, status: depositStatus(b.withheld, b.deposited, true), fine: fines?.get(b.key) ?? null });
    }
  }

  // Withheld in a period that no deposit item covers: it must not vanish just because the schedule has a gap.
  const lines = (await tdsWithheldLines(tenantId, from, to)).filter((l) => keep(l.headKey));
  rows.push(...uncoveredRows(lines, obligations.filter((o) => o.periodStart && o.periodEnd).map((o) => ({ periodStart: o.periodStart!, periodEnd: o.periodEnd! })), nameOf));

  rows.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  return { rows, byHeading: positionByHeading(rows), fineBasis: basis };
}

/** The deposits made against one deposit item: each amount and the day it was paid, by heading. Voided payments are left out. */
async function depositDates(tenantId: string, obligationId: string): Promise<Map<string | null, Tranche[]>> {
  const rows = await db
    .select({ key: paymentAllocations.tdsHeadKey, amount: paymentAllocations.allocatedAmount, date: payments.paymentDate })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(paymentAllocations.targetType, "tax_obligation"), eq(paymentAllocations.targetId, obligationId), ne(payments.status, "voided")));
  const out = new Map<string | null, Tranche[]>();
  for (const r of rows) out.set(r.key, [...(out.get(r.key) ?? []), { amount: Number(r.amount), date: r.date }]);
  return out;
}
