import { and, asc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceTaxHeads, payrollLines, payrollRuns, tenants } from "@/db/schema";
import { fiscalYearOf, ymdOf } from "@/lib/calendar";
import { fiscalCalendar } from "@/lib/compliance/platform-tax-rates";
export * from "./salary-tax-calc";

// The lookups salary TDS needs from the database: the fiscal year, the months left in it, and what was already paid and withheld.

/** The fiscal year a pay period falls in, how many months of it are left (the period's own included), and which heading holds the payroll slabs. */
export async function payrollTaxContext(tenantId: string, periodStart: string) {
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const countryCode = tenant?.countryCode ?? "";
  const { calendar, startMonth } = await fiscalCalendar(countryCode);
  const fy = fiscalYearOf(calendar, startMonth, periodStart);
  const month = ymdOf(calendar, periodStart)?.month ?? startMonth;
  const monthsLeft = 12 - ((month - startMonth + 12) % 12);
  const [head] = await db
    .select({ key: complianceTaxHeads.key })
    .from(complianceTaxHeads)
    .where(and(eq(complianceTaxHeads.countryCode, countryCode), eq(complianceTaxHeads.taxTypeKey, "tds"), eq(complianceTaxHeads.kind, "slabs"), eq(complianceTaxHeads.module, "payroll"), eq(complianceTaxHeads.isActive, true)))
    .orderBy(asc(complianceTaxHeads.sortOrder))
    .limit(1);
  return { countryCode, fy, monthsLeft, headKey: head?.key ?? null };
}

/** What an employee was paid (taxable pay), had withheld and put into retirement schemes in this fiscal year, in the runs before this period. */
export async function earlierInFiscalYear(tenantId: string, employeeId: string, fyFrom: string, periodStart: string, excludeRunId: string) {
  const [row] = await db
    .select({
      earned: sql<string>`coalesce(sum(coalesce(${payrollLines.taxablePay}, ${payrollLines.grossPay})), 0)`,
      withheld: sql<string>`coalesce(sum(${payrollLines.tdsAmount}), 0)`,
      retirement: sql<string>`coalesce(sum(${payrollLines.employeeRetirement}), 0)`,
    })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
    .where(and(eq(payrollLines.tenantId, tenantId), eq(payrollLines.employeeId, employeeId), gte(payrollRuns.periodStart, fyFrom), lt(payrollRuns.periodEnd, periodStart), ne(payrollRuns.id, excludeRunId)));
  return { earned: Number(row.earned), withheld: Number(row.withheld), retirement: Number(row.retirement) };
}
