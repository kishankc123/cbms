import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollLines, payrollRuns, staffAdvanceRecoveries, staffAdvances } from "@/db/schema";
import { monthClosed } from "./staff-advances";
import { staffBalances } from "./staff-account";
import { overpaidAdjustment, overpaidOf } from "./overpaid-rules";

type Run = typeof payrollRuns.$inferSelect;
const round2 = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * What is still to be recovered on open advances, per employee: all of it (`total`), and the part still waiting for its payroll month (`pending`). With
 * `withoutRunId`, the picture as it stands without that run: what it recovered is outstanding, and it closes no month.
 */
async function advancesOutstanding(tenantId: string, withoutRunId?: string) {
  const [advances, recovered, finalized] = await Promise.all([
    db.select().from(staffAdvances).where(and(eq(staffAdvances.tenantId, tenantId), eq(staffAdvances.status, "open"))),
    db
      .select({ advanceId: staffAdvanceRecoveries.advanceId, v: sql<string>`sum(${staffAdvanceRecoveries.amount})` })
      .from(staffAdvanceRecoveries)
      .where(and(eq(staffAdvanceRecoveries.tenantId, tenantId), ...(withoutRunId ? [ne(staffAdvanceRecoveries.payrollRunId, withoutRunId)] : [])))
      .groupBy(staffAdvanceRecoveries.advanceId),
    db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized"), ...(withoutRunId ? [ne(payrollRuns.id, withoutRunId)] : []))),
  ]);
  const got = new Map(recovered.map((r) => [r.advanceId, Number(r.v)]));
  const total = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const a of advances) {
    const left = Math.max(round2(Number(a.amount) - (got.get(a.id) ?? 0)), 0);
    if (left === 0) continue;
    total.set(a.employeeId, round2((total.get(a.employeeId) ?? 0) + left));
    if (!monthClosed(finalized, a.forCalendar, a.forMonth, a.forYear, a.forPeriodStart)) pending.set(a.employeeId, round2((pending.get(a.employeeId) ?? 0) + left));
  }
  return { total, pending };
}

export type OverpaidEmployee = { employeeId: string; code: string; name: string; overpaid: number };

/** Everyone who owes the company more than the advances still waiting for their payroll month, the largest first. */
export async function overpaidStaff(tenantId: string): Promise<OverpaidEmployee[]> {
  const [people, balances, advances] = await Promise.all([
    db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName }).from(employees).where(eq(employees.tenantId, tenantId)),
    staffBalances(tenantId),
    advancesOutstanding(tenantId),
  ]);
  return people
    .map((p) => ({ employeeId: p.id, code: p.code, name: p.name, overpaid: overpaidOf(balances.get(p.id) ?? 0, advances.pending.get(p.id) ?? 0) }))
    .filter((p) => p.overpaid > 0.005)
    .sort((a, b) => b.overpaid - a.overpaid);
}

const linesOf = (tenantId: string, runId: string) =>
  db
    .select({ id: payrollLines.id, employeeId: payrollLines.employeeId, netPay: payrollLines.netPay, advanceRecovered: payrollLines.advanceRecovered })
    .from(payrollLines)
    .where(and(eq(payrollLines.tenantId, tenantId), eq(payrollLines.payrollRunId, runId)));

/**
 * For a run that is not posted yet: what each line takes off its net pay because it was already paid (see overpaidAdjustment), keyed by line id. A finalized run
 * keeps the figure worked out when it was finalized, on the line itself.
 */
export async function draftOverpaidAdjustments(tenantId: string, run: Run): Promise<Map<string, number>> {
  const [lines, balances, advances] = await Promise.all([linesOf(tenantId, run.id), staffBalances(tenantId), advancesOutstanding(tenantId, run.id)]);
  return new Map(lines.map((l) => [l.id, overpaidAdjustment(balances.get(l.employeeId) ?? 0, advances.total.get(l.employeeId) ?? 0, Number(l.netPay))]));
}

/** Who would show as overpaid (or more overpaid) if a finalized run's salary were taken back off their accounts, with what they would then show. */
export async function overpaidAfterReversal(tenantId: string, run: Run): Promise<{ name: string; overpaid: number }[]> {
  const lines = await linesOf(tenantId, run.id);
  if (lines.length === 0) return [];
  const [people, balances, now, after] = await Promise.all([
    db.select({ id: employees.id, name: employees.fullName }).from(employees).where(and(eq(employees.tenantId, tenantId), inArray(employees.id, lines.map((l) => l.employeeId)))),
    staffBalances(tenantId, lines.map((l) => l.employeeId)),
    advancesOutstanding(tenantId),
    advancesOutstanding(tenantId, run.id),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return lines
    .map((l) => {
      const balance = balances.get(l.employeeId) ?? 0;
      // The run credited the net pay and set off the advance, so both come back off the account.
      const then = overpaidOf(round2(balance - Number(l.netPay) - Number(l.advanceRecovered)), after.pending.get(l.employeeId) ?? 0);
      return { name: nameOf.get(l.employeeId) ?? "An employee", overpaid: then, before: overpaidOf(balance, now.pending.get(l.employeeId) ?? 0) };
    })
    .filter((p) => p.overpaid > p.before + 0.005)
    .map(({ name, overpaid }) => ({ name, overpaid }));
}
