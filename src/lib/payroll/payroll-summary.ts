import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, payrollRuns, payrollLines } from "@/db/schema";
import { payrollPeriodLabel } from "./period-label";

const round2 = (n: number) => Math.round(n * 100) / 100;
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

export type PayrollSummaryRunRow = {
  runId: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  employeeCount: number;
  grossPay: number;
  allowances: number;
  deductions: number;
  overtimeAmount: number;
  benefitsAmount: number;
  advanceRecovered: number;
  netPay: number;
};

/**
 * Every finalized payroll run whose accrual posted within the period (the same "payroll" sourceType
 * every other report drills through), with each run's own totals from payroll_lines — the snapshot
 * frozen at finalization, never recomputed even if salaryHistory/benefits change later.
 */
export async function payrollSummary(tenantId: string, periodStart: Date, periodEnd: Date) {
  const startStr = toDateStr(periodStart);
  const endStr = toDateStr(periodEnd);

  const entries = await db
    .select({ sourceId: journalEntries.sourceId })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.sourceType, "payroll"),
        eq(journalEntries.isReversed, false),
        gte(journalEntries.entryDate, startStr),
        lte(journalEntries.entryDate, endStr)
      )
    );
  const runIds = [...new Set(entries.map((e) => e.sourceId).filter((x): x is string => Boolean(x)))];
  if (runIds.length === 0) return { runs: [] as PayrollSummaryRunRow[] };

  const [runs, lines] = await Promise.all([
    db.select().from(payrollRuns).where(inArray(payrollRuns.id, runIds)),
    db.select().from(payrollLines).where(inArray(payrollLines.payrollRunId, runIds)),
  ]);

  const linesByRun = new Map<string, typeof lines>();
  for (const l of lines) linesByRun.set(l.payrollRunId, [...(linesByRun.get(l.payrollRunId) ?? []), l]);

  const runRows: PayrollSummaryRunRow[] = runs
    .map((r) => {
      const runLines = linesByRun.get(r.id) ?? [];
      return {
        runId: r.id,
        label: payrollPeriodLabel(r),
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        employeeCount: runLines.length,
        grossPay: round2(runLines.reduce((s, l) => s + Number(l.grossPay), 0)),
        allowances: round2(runLines.reduce((s, l) => s + Number(l.allowances), 0)),
        deductions: round2(runLines.reduce((s, l) => s + Number(l.deductions), 0)),
        overtimeAmount: round2(runLines.reduce((s, l) => s + Number(l.overtimeAmount), 0)),
        benefitsAmount: round2(runLines.reduce((s, l) => s + Number(l.benefitsAmount), 0)),
        advanceRecovered: round2(runLines.reduce((s, l) => s + Number(l.advanceRecovered), 0)),
        netPay: round2(runLines.reduce((s, l) => s + Number(l.netPay), 0)),
      };
    })
    .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));

  return { runs: runRows };
}
