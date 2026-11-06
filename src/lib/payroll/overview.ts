import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employeeRetirement, employees, payrollLines, payrollRuns } from "@/db/schema";
import { payrollPeriodLabel } from "./period-label";
export { attentionItems, type AttentionInput, type AttentionItem } from "./overview-rules";

// What the Payroll overview shows: headline figures for the latest run, the recent runs, and what needs attention before the next one.

export async function loadOverview(tenantId: string) {
  const people = await db.select({ id: employees.id, status: employees.employmentStatus, pan: employees.panNumber, bank: employees.bankAccountNumber }).from(employees).where(eq(employees.tenantId, tenantId));
  const active = people.filter((p) => p.status === "active");
  const enrolments = await db.select().from(employeeRetirement).where(eq(employeeRetirement.tenantId, tenantId));
  const activeIds = new Set(active.map((p) => p.id));
  const today = new Date().toISOString().slice(0, 10);
  const liveEnrolments = enrolments.filter((e) => activeIds.has(e.employeeId) && e.startDate <= today && (!e.endDate || e.endDate >= today));

  const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.tenantId, tenantId)).orderBy(desc(payrollRuns.periodStart)).limit(6);
  const totals = runs.length
    ? await db
        .select({
          runId: payrollLines.payrollRunId,
          employees: sql<number>`count(*)::int`,
          gross: sql<string>`coalesce(sum(${payrollLines.grossPay}), 0)`,
          net: sql<string>`coalesce(sum(${payrollLines.netPay}), 0)`,
          tds: sql<string>`coalesce(sum(${payrollLines.tdsAmount}), 0)`,
          employer: sql<string>`coalesce(sum(${payrollLines.employerRetirement}), 0)`,
        })
        .from(payrollLines)
        .where(and(eq(payrollLines.tenantId, tenantId), inArray(payrollLines.payrollRunId, runs.map((r) => r.id))))
        .groupBy(payrollLines.payrollRunId)
    : [];
  const byRun = new Map(totals.map((t) => [t.runId, t]));
  const recent = runs.map((r) => {
    const t = byRun.get(r.id);
    return { id: r.id, label: payrollPeriodLabel(r), periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status, employees: t?.employees ?? 0, gross: Number(t?.gross ?? 0), net: Number(t?.net ?? 0), tds: Number(t?.tds ?? 0), employer: Number(t?.employer ?? 0) };
  });

  return {
    activeEmployees: active.length,
    attention: { missingPan: active.filter((p) => !(p.pan ?? "").trim()).length, missingBank: active.filter((p) => !(p.bank ?? "").trim()).length, enrolledWithoutRegistration: liveEnrolments.filter((e) => !(e.registrationNumber ?? "").trim()).length, anyEnrolled: liveEnrolments.length > 0 },
    recent,
  };
}
