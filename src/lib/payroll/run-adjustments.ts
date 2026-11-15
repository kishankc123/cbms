import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, employeeComponents, employees, payrollComponents, payrollLines } from "@/db/schema";
import type { AdjustmentKind, RunAdjustment } from "./adjustment-labels";

// A one-off adjustment on one employee's pay for one month: an extra allowance or a deduction, with a reason. It is an ordinary one-time salary component given to
// that person on a date inside the run's period, so the salary tax, the retirement contributions and the payslip treat it exactly as they treat a bonus; it
// survives Recalculate (the run is rebuilt from these records) and is removed with Remove.
//
// Taxable by default. A taxable allowance is part of the pay salary tax is worked on and counts towards the retirement contributions; one marked
// non-taxable does neither. A deduction only takes from the pay.

export { ADJUSTMENT_KIND_LABEL, type AdjustmentKind, type RunAdjustment } from "./adjustment-labels";

const SPEC: Record<AdjustmentKind, { name: string; type: "allowance" | "deduction"; taxable: boolean; countsForRetirement: boolean }> = {
  allowance: { name: "One-off adjustment (taxable allowance)", type: "allowance", taxable: true, countsForRetirement: true },
  allowance_free: { name: "One-off adjustment (non-taxable allowance)", type: "allowance", taxable: false, countsForRetirement: false },
  deduction: { name: "One-off adjustment (deduction)", type: "deduction", taxable: false, countsForRetirement: false },
};
const KINDS = Object.keys(SPEC) as AdjustmentKind[];
const kindOf = (name: string): AdjustmentKind | null => KINDS.find((k) => SPEC[k].name === name) ?? null;

export type RunPeriod = { id: string; periodStart: string; periodEnd: string; status: string };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The salary component behind one kind of adjustment, made the first time it is needed. */
async function componentId(tenantId: string, kind: AdjustmentKind): Promise<string> {
  const s = SPEC[kind];
  const [found] = await db.select({ id: payrollComponents.id }).from(payrollComponents).where(and(eq(payrollComponents.tenantId, tenantId), eq(payrollComponents.name, s.name))).limit(1);
  if (found) return found.id;
  const [made] = await db
    .insert(payrollComponents)
    .values({ tenantId, name: s.name, type: s.type, amount: "0", taxable: s.taxable, calcType: "fixed", countsForRetirement: s.countsForRetirement, recurrence: "one_time", autoAssign: false })
    .returning({ id: payrollComponents.id });
  return made.id;
}

export async function listRunAdjustments(tenantId: string, run: RunPeriod): Promise<RunAdjustment[]> {
  const rows = await db
    .select({ id: employeeComponents.id, employeeId: employeeComponents.employeeId, employeeName: employees.fullName, amount: employeeComponents.amount, reason: employeeComponents.notes, name: payrollComponents.name })
    .from(employeeComponents)
    .innerJoin(payrollComponents, eq(payrollComponents.id, employeeComponents.componentId))
    .innerJoin(employees, eq(employees.id, employeeComponents.employeeId))
    .where(and(eq(employeeComponents.tenantId, tenantId), inArray(payrollComponents.name, KINDS.map((k) => SPEC[k].name)), gte(employeeComponents.effectiveFrom, run.periodStart), lte(employeeComponents.effectiveFrom, run.periodEnd)));
  return rows
    .map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, kind: kindOf(r.name)!, amount: Number(r.amount ?? 0), reason: r.reason ?? "" }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** Adds an adjustment to a run that is not finalized. The caller then recalculates the run. */
export async function addRunAdjustment(tenantId: string, userId: string, run: RunPeriod, input: { employeeId: string; kind: string; amount: number; reason: string }): Promise<void> {
  if (run.status === "finalized") throw new Error("This payroll run is finalized. Reverse it first, then adjust it.");
  const kind = KINDS.find((k) => k === input.kind);
  if (!kind) throw new Error("Choose what kind of adjustment this is.");
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (amount > 1_000_000_000) throw new Error("That amount is too large.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Give a short reason, so the adjustment can be understood later.");
  if (reason.length > 200) throw new Error("Keep the reason to 200 characters or fewer.");

  const [line] = await db.select({ id: payrollLines.id }).from(payrollLines).where(and(eq(payrollLines.tenantId, tenantId), eq(payrollLines.payrollRunId, run.id), eq(payrollLines.employeeId, input.employeeId))).limit(1);
  if (!line) throw new Error("That employee is not in this payroll run.");

  const [row] = await db
    .insert(employeeComponents)
    .values({ tenantId, employeeId: input.employeeId, componentId: await componentId(tenantId, kind), amount: amount.toFixed(2), effectiveFrom: run.periodEnd, notes: reason, createdBy: userId })
    .returning({ id: employeeComponents.id });
  await db.insert(auditLog).values({ tenantId, userId, action: "payroll_adjustment_added", entityType: "payroll_run", entityId: run.id, afterValue: { employeeId: input.employeeId, kind, amount, reason, assignmentId: row.id } });
}

/** Takes an adjustment off a run that is not finalized. Only adjustments made this way can be removed here. */
export async function removeRunAdjustment(tenantId: string, userId: string, run: RunPeriod, assignmentId: string): Promise<void> {
  if (run.status === "finalized") throw new Error("This payroll run is finalized. Reverse it first, then adjust it.");
  const found = (await listRunAdjustments(tenantId, run)).find((a) => a.id === assignmentId);
  if (!found) throw new Error("That adjustment is not on this payroll run.");
  await db.delete(employeeComponents).where(and(eq(employeeComponents.id, assignmentId), eq(employeeComponents.tenantId, tenantId)));
  await db.insert(auditLog).values({ tenantId, userId, action: "payroll_adjustment_removed", entityType: "payroll_run", entityId: run.id, beforeValue: { employeeId: found.employeeId, kind: found.kind, amount: found.amount, reason: found.reason } });
}
