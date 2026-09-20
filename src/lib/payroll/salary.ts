import { and, eq, lte, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { salaryHistory, type prorationMethodEnum } from "@/db/schema";

import { todayIso } from "@/lib/calendar";
type ProrationMethod = (typeof prorationMethodEnum.enumValues)[number];

function toDate(s: string) {
  return new Date(s + "T00:00:00Z");
}
function toDateString(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, days: number) {
  const d = toDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}
function dayCount(startStr: string, endStr: string) {
  const start = toDate(startStr);
  const end = toDate(endStr);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

// The salary applicable on a given date — the most recent salaryHistory
// record whose effectiveFrom is on or before that date. This is the ONLY
// way salary should ever be looked up; there is no other source of truth.
export async function getSalaryAsOf(tenantId: string, employeeId: string, asOfDate: string): Promise<number | null> {
  const [row] = await db
    .select()
    .from(salaryHistory)
    .where(and(eq(salaryHistory.tenantId, tenantId), eq(salaryHistory.employeeId, employeeId), lte(salaryHistory.effectiveFrom, asOfDate)))
    .orderBy(desc(salaryHistory.effectiveFrom))
    .limit(1);
  return row ? Number(row.basicSalary) : null;
}

export async function getCurrentSalary(tenantId: string, employeeId: string): Promise<number | null> {
  return getSalaryAsOf(tenantId, employeeId, todayIso());
}

export async function getSalaryTimeline(tenantId: string, employeeId: string) {
  return db
    .select()
    .from(salaryHistory)
    .where(and(eq(salaryHistory.tenantId, tenantId), eq(salaryHistory.employeeId, employeeId)))
    .orderBy(desc(salaryHistory.effectiveFrom));
}

type SalarySegment = { start: string; end: string; salary: number };

// Splits a payroll period into segments wherever a salary change lands
// inside it, so a mid-period raise can be prorated correctly.
async function getSalarySegments(tenantId: string, employeeId: string, periodStart: string, periodEnd: string): Promise<SalarySegment[]> {
  const rows = await db
    .select()
    .from(salaryHistory)
    .where(and(eq(salaryHistory.tenantId, tenantId), eq(salaryHistory.employeeId, employeeId), lte(salaryHistory.effectiveFrom, periodEnd)))
    .orderBy(asc(salaryHistory.effectiveFrom));

  if (rows.length === 0) return [];

  let startIdx = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].effectiveFrom <= periodStart) startIdx = i;
    else break;
  }
  const relevant = rows.slice(startIdx);

  const segments: SalarySegment[] = [];
  for (let i = 0; i < relevant.length; i++) {
    const start = i === 0 ? periodStart : relevant[i].effectiveFrom;
    const end = i === relevant.length - 1 ? periodEnd : addDays(relevant[i + 1].effectiveFrom, -1);
    segments.push({ start, end, salary: Number(relevant[i].basicSalary) });
  }
  return segments;
}

// The basic salary to use for a whole payroll period, applying the
// configured mid-period-change behavior when a raise/cut lands inside it.
// A period with no salary change inside it is unaffected by the setting.
export async function computeBasicForPeriod(
  tenantId: string,
  employeeId: string,
  periodStart: string,
  periodEnd: string,
  prorationMethod: ProrationMethod
): Promise<{ basic: number; segments: SalarySegment[] }> {
  const segments = await getSalarySegments(tenantId, employeeId, periodStart, periodEnd);
  if (segments.length === 0) return { basic: 0, segments };
  if (segments.length === 1) return { basic: segments[0].salary, segments };

  if (prorationMethod === "new_full_month") return { basic: segments[segments.length - 1].salary, segments };
  if (prorationMethod === "old_full_month") return { basic: segments[0].salary, segments };

  const totalDays = dayCount(periodStart, periodEnd);
  const weighted = segments.reduce((sum, seg) => sum + seg.salary * (dayCount(seg.start, seg.end) / totalDays), 0);
  return { basic: Math.round(weighted * 100) / 100, segments };
}
