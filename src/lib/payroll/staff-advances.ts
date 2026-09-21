import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { payrollLines, payrollRuns, staffAdvanceRecoveries, staffAdvances } from "@/db/schema";

type Run = typeof payrollRuns.$inferSelect;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type OutstandingAdvance = {
  id: string;
  advanceDate: string;
  forCalendar: string;
  forMonth: number;
  forYear: number;
  amount: number;
  recovered: number;
  outstanding: number;
};

/**
 * An employee's open staff advances with what is still to be recovered from each, oldest first. `upToPeriodEnd` leaves
 * out advances taken against a later month than a payroll period (they are recovered from that month's pay, not this one's);
 * `excludeRunId` ignores what that run itself recovered (so a run can be checked against its own recoveries).
 */
export async function outstandingAdvances(tenantId: string, employeeId: string, opts: { upToPeriodEnd?: string; excludeRunId?: string } = {}): Promise<OutstandingAdvance[]> {
  const advances = await db
    .select()
    .from(staffAdvances)
    .where(and(eq(staffAdvances.tenantId, tenantId), eq(staffAdvances.employeeId, employeeId), eq(staffAdvances.status, "open"), ...(opts.upToPeriodEnd ? [lte(staffAdvances.forPeriodStart, opts.upToPeriodEnd)] : [])));
  if (advances.length === 0) return [];
  const recovered = await db
    .select({ advanceId: staffAdvanceRecoveries.advanceId, v: sql<string>`sum(${staffAdvanceRecoveries.amount})` })
    .from(staffAdvanceRecoveries)
    .where(and(eq(staffAdvanceRecoveries.tenantId, tenantId), inArray(staffAdvanceRecoveries.advanceId, advances.map((a) => a.id)), ...(opts.excludeRunId ? [ne(staffAdvanceRecoveries.payrollRunId, opts.excludeRunId)] : [])))
    .groupBy(staffAdvanceRecoveries.advanceId);
  const recoveredBy = new Map(recovered.map((r) => [r.advanceId, Number(r.v)]));
  return advances
    .map((a) => {
      const got = round2(recoveredBy.get(a.id) ?? 0);
      return { id: a.id, advanceDate: a.advanceDate, forCalendar: a.forCalendar, forMonth: a.forMonth, forYear: a.forYear, amount: Number(a.amount), recovered: got, outstanding: round2(Number(a.amount) - got), createdAt: a.createdAt.getTime() };
    })
    .filter((a) => a.outstanding > 0.005)
    .sort((x, y) => (x.advanceDate < y.advanceDate ? -1 : x.advanceDate > y.advanceDate ? 1 : x.createdAt - y.createdAt))
    .map((a) => ({ id: a.id, advanceDate: a.advanceDate, forCalendar: a.forCalendar, forMonth: a.forMonth, forYear: a.forYear, amount: a.amount, recovered: a.recovered, outstanding: a.outstanding }));
}

/** Takes the advances oldest first until the cap (what the employee takes home before any recovery) is used up. */
export async function planEmployeeRecovery(tenantId: string, employeeId: string, periodEnd: string, takeHome: number, excludeRunId?: string) {
  let room = Math.max(round2(takeHome), 0);
  const parts: { advanceId: string; amount: number }[] = [];
  for (const a of await outstandingAdvances(tenantId, employeeId, { upToPeriodEnd: periodEnd, excludeRunId })) {
    if (room <= 0.004) break;
    const take = round2(Math.min(a.outstanding, room));
    parts.push({ advanceId: a.id, amount: take });
    room = round2(room - take);
  }
  return { total: round2(parts.reduce((s, p) => s + p.amount, 0)), parts };
}

/** The advances a run recovers, worked out from its lines: gross - deductions is what can be recovered from each employee. */
async function planRun(tenantId: string, run: Run) {
  const lines = await db
    .select({ id: payrollLines.id, employeeId: payrollLines.employeeId, grossPay: payrollLines.grossPay, deductions: payrollLines.deductions, advanceRecovered: payrollLines.advanceRecovered })
    .from(payrollLines)
    .where(eq(payrollLines.payrollRunId, run.id));
  const plans = [];
  for (const l of lines) {
    const plan = await planEmployeeRecovery(tenantId, l.employeeId, run.periodEnd, Number(l.grossPay) - Number(l.deductions), run.id);
    plans.push({ line: l, ...plan });
  }
  return plans;
}

/** Refuses to finalize a run whose advance recoveries no longer match the advances on record (one was added, changed or voided since it was generated). */
export async function assertRunAdvancesCurrent(tenantId: string, run: Run) {
  for (const p of await planRun(tenantId, run)) {
    if (Math.abs(p.total - Number(p.line.advanceRecovered)) > 0.005) {
      throw new Error("Staff advances have changed since this payroll run was generated — regenerate the run so its advance recoveries are up to date, then finalize it");
    }
  }
}

/** Records what a finalized run recovered from each advance. */
export async function recordRunRecoveries(tenantId: string, run: Run) {
  await removeRunRecoveries(tenantId, run.id);
  const rows = (await planRun(tenantId, run)).flatMap((p) => p.parts.map((x) => ({ tenantId, advanceId: x.advanceId, payrollRunId: run.id, amount: x.amount.toFixed(2) })));
  if (rows.length > 0) await db.insert(staffAdvanceRecoveries).values(rows);
}

/** Gives a run's recoveries back (its finalization was reversed or rolled back): the advances are outstanding again. */
export async function removeRunRecoveries(tenantId: string, runId: string) {
  await db.delete(staffAdvanceRecoveries).where(and(eq(staffAdvanceRecoveries.tenantId, tenantId), eq(staffAdvanceRecoveries.payrollRunId, runId)));
}

/** A finalized run — for the month the advance is taken against, or any run covering that month's first day — closes that month. */
export async function assertMonthOpenForAdvance(tenantId: string, forCalendar: string, forMonth: number, forYear: number, forPeriodStart: string) {
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized")));
  const closed = runs.find((r) => (r.calendarSystem === forCalendar && r.month === forMonth && r.year === forYear) || (r.periodStart <= forPeriodStart && r.periodEnd >= forPeriodStart));
  if (closed) throw new Error("Payroll for that month has already been finalized — choose a later month for this advance");
}

/** Advances for one employee, with what has been recovered — for the profile page. */
export async function listEmployeeAdvances(tenantId: string, employeeId: string) {
  const advances = await db.select().from(staffAdvances).where(and(eq(staffAdvances.tenantId, tenantId), eq(staffAdvances.employeeId, employeeId)));
  const recs = advances.length
    ? await db
        .select({ advanceId: staffAdvanceRecoveries.advanceId, v: sql<string>`sum(${staffAdvanceRecoveries.amount})` })
        .from(staffAdvanceRecoveries)
        .where(and(eq(staffAdvanceRecoveries.tenantId, tenantId), inArray(staffAdvanceRecoveries.advanceId, advances.map((a) => a.id))))
        .groupBy(staffAdvanceRecoveries.advanceId)
    : [];
  const by = new Map(recs.map((r) => [r.advanceId, Number(r.v)]));
  return advances
    .map((a) => ({ id: a.id, advanceDate: a.advanceDate, forCalendar: a.forCalendar, forMonth: a.forMonth, forYear: a.forYear, amount: Number(a.amount), recovered: round2(by.get(a.id) ?? 0), status: a.status }))
    .sort((x, y) => (x.advanceDate < y.advanceDate ? 1 : -1));
}

/** What an employee still owes back on open advances. */
export async function getEmployeeAdvanceOutstanding(tenantId: string, employeeId: string): Promise<number> {
  return round2((await outstandingAdvances(tenantId, employeeId)).reduce((s, a) => s + a.outstanding, 0)) + 0;
}

/** Which advances a run recovered (or, before it is finalized, would recover), for the salary sheet. */
export async function getRunRecoveryBreakdown(tenantId: string, run: Run) {
  const rows =
    run.status === "finalized"
      ? await db
          .select({ employeeId: staffAdvances.employeeId, advanceDate: staffAdvances.advanceDate, forCalendar: staffAdvances.forCalendar, forMonth: staffAdvances.forMonth, forYear: staffAdvances.forYear, amount: staffAdvanceRecoveries.amount })
          .from(staffAdvanceRecoveries)
          .innerJoin(staffAdvances, eq(staffAdvances.id, staffAdvanceRecoveries.advanceId))
          .where(and(eq(staffAdvanceRecoveries.tenantId, tenantId), eq(staffAdvanceRecoveries.payrollRunId, run.id)))
      : await (async () => {
          const parts = (await planRun(tenantId, run)).flatMap((p) => p.parts.map((x) => ({ employeeId: p.line.employeeId, advanceId: x.advanceId, amount: x.amount.toFixed(2) })));
          if (parts.length === 0) return [];
          const adv = await db.select().from(staffAdvances).where(inArray(staffAdvances.id, parts.map((p) => p.advanceId)));
          const byId = new Map(adv.map((a) => [a.id, a]));
          return parts.map((p) => ({ employeeId: p.employeeId, advanceDate: byId.get(p.advanceId)!.advanceDate, forCalendar: byId.get(p.advanceId)!.forCalendar, forMonth: byId.get(p.advanceId)!.forMonth, forYear: byId.get(p.advanceId)!.forYear, amount: p.amount }));
        })();
  return rows.map((r) => ({ ...r, amount: Number(r.amount) })).sort((a, b) => (a.advanceDate < b.advanceDate ? -1 : 1));
}
