import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations } from "@/db/schema";
import { NOT_ASSIGNED, tdsDepositBreakdown, tdsHeadNames, tdsWithheldLines } from "./tds-by-heading";
import { depositStatus, positionByHeading, uncoveredRows, type DepositMonthRow, type TdsDepositPosition } from "./tds-deposit-rules";
export type { TdsDepositPosition } from "./tds-deposit-rules";

/**
 * TDS withheld against TDS deposited, for every deposit period (compliance item) that overlaps the range, by heading. A deposit counts for the
 * period it pays for, not the day the money moved. TDS withheld in a month nobody has a deposit item for is listed too, as "no deposit item".
 * `onlyHeadKey` limits it to one heading (payroll's own report asks for its salary heading).
 */
export async function tdsDepositPosition(tenantId: string, from: string, to: string, onlyHeadKey?: string | null): Promise<TdsDepositPosition> {
  const names = await tdsHeadNames(tenantId);
  const nameOf = (key: string | null) => (key ? names.get(key) ?? key : NOT_ASSIGNED);
  const keep = (key: string | null) => onlyHeadKey === undefined || key === onlyHeadKey;

  const obligations = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.taxTypeKey, "tds"), ne(complianceObligations.status, "not_applicable"), lte(complianceObligations.periodStart, to), gte(complianceObligations.periodEnd, from)))
    .orderBy(asc(complianceObligations.periodStart));

  const rows: DepositMonthRow[] = [];
  for (const ob of obligations) {
    if (!ob.periodStart || !ob.periodEnd) continue;
    for (const b of await tdsDepositBreakdown(tenantId, ob)) {
      if (!keep(b.key)) continue;
      rows.push({ obligationId: ob.id, period: ob.periodLabel ?? ob.name, periodStart: ob.periodStart, periodEnd: ob.periodEnd, headKey: b.key, heading: b.name, withheld: b.withheld, deposited: b.deposited, remaining: b.remaining, status: depositStatus(b.withheld, b.deposited, true) });
    }
  }

  // Withheld in a period that no deposit item covers: it must not vanish just because the schedule has a gap.
  const lines = (await tdsWithheldLines(tenantId, from, to)).filter((l) => keep(l.headKey));
  rows.push(...uncoveredRows(lines, obligations.filter((o) => o.periodStart && o.periodEnd).map((o) => ({ periodStart: o.periodStart!, periodEnd: o.periodEnd! })), nameOf));

  rows.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  return { rows, byHeading: positionByHeading(rows) };
}
