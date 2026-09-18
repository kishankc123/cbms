"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeeBenefits, attendanceRecords, payrollComponents, payrollRuns, payrollLines, auditLog } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { computeBasicForPeriod } from "@/lib/payroll/salary";
import { getOrCreateSettings } from "../setup/actions";
import { postJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import {
  getOrCreateSalaryExpenseAccount,
  getOrCreatePayrollDeductionsAccount,
  createEmployeePayableAccount,
} from "@/lib/ledger/payroll-accounts";

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function periodForMonth(year: number, month: number, startDay: number, endDay: number) {
  const lastDay = daysInMonth(year, month);
  const start = Math.min(Math.max(startDay, 1), lastDay);
  const end = Math.min(Math.max(endDay, start), lastDay);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    periodStart: `${year}-${pad(month)}-${pad(start)}`,
    periodEnd: `${year}-${pad(month)}-${pad(end)}`,
  };
}

function dayCount(startStr: string, endStr: string) {
  const start = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function eachDate(startStr: string, endStr: string) {
  const dates: string[] = [];
  const cur = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export type GenerateRunInput = {
  month: number;
  year: number;
  employeeIds: string[]; // empty = all active employees
};

// Recomputes a payroll run's lines from the salary/benefits/attendance
// applicable to the selected period — never from the employee's "current"
// salary. Blocked once the run is finalized, per the immutability rule.
export async function generatePayrollRun(input: GenerateRunInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");

  const settings = await getOrCreateSettings(session.tenantId);
  const { periodStart, periodEnd } = periodForMonth(input.year, input.month, settings.payrollStartDay, settings.payrollEndDay);

  const [existingRun] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, session.tenantId), eq(payrollRuns.month, input.month), eq(payrollRuns.year, input.year)))
    .limit(1);
  if (existingRun && existingRun.status === "finalized") {
    throw new Error("This payroll period is already finalized and cannot be regenerated");
  }

  const employeeList = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, session.tenantId),
        ...(input.employeeIds.length > 0 ? [inArray(employees.id, input.employeeIds)] : [eq(employees.employmentStatus, "active")])
      )
    );
  if (employeeList.length === 0) throw new Error("No employees to include in this payroll run");

  const components = await db.select().from(payrollComponents).where(eq(payrollComponents.tenantId, session.tenantId));
  const allowanceTotal = components.filter((c) => c.type === "allowance").reduce((s, c) => s + Number(c.amount), 0);
  const deductionTotal = components.filter((c) => c.type === "deduction").reduce((s, c) => s + Number(c.amount), 0);

  const periodDates = eachDate(periodStart, periodEnd);
  const totalPeriodDays = periodDates.length;

  const run =
    existingRun ??
    (
      await db
        .insert(payrollRuns)
        .values({ tenantId: session.tenantId, month: input.month, year: input.year, periodStart, periodEnd, createdBy: session.userId })
        .returning()
    )[0];

  await db.delete(payrollLines).where(eq(payrollLines.payrollRunId, run.id));

  for (const employee of employeeList) {
    const { basic } = await computeBasicForPeriod(session.tenantId, employee.id, periodStart, periodEnd, settings.prorationMethod);

    const attendance = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.tenantId, session.tenantId), eq(attendanceRecords.employeeId, employee.id)));
    const attendanceByDate = new Map(attendance.map((a) => [a.date, a.status]));

    const weeklyHolidaySet = new Set(settings.weeklyHolidays);
    const publicHolidaySet = new Set(settings.publicHolidays);

    let workingDays = 0;
    let presentDays = 0;
    for (const dateStr of periodDates) {
      const dayOfWeek = new Date(dateStr + "T00:00:00Z").getUTCDay();
      const isHoliday =
        settings.workingDaysMethod === "exclude_weekly_holidays" && (weeklyHolidaySet.has(dayOfWeek) || publicHolidaySet.has(dateStr));
      if (!isHoliday) workingDays++;

      const status = attendanceByDate.get(dateStr) ?? "present";
      if (isHoliday) continue;
      if (status === "present") presentDays += 1;
      else if (status === "half_day") presentDays += 0.5;
      // absent / leave contribute 0
    }
    if (workingDays === 0) workingDays = totalPeriodDays;
    const absentDays = round2(workingDays - presentDays);

    const proratedBasic = round2(basic * (presentDays / workingDays));

    const benefitRows = await db
      .select()
      .from(employeeBenefits)
      .where(
        and(
          eq(employeeBenefits.tenantId, session.tenantId),
          eq(employeeBenefits.employeeId, employee.id),
          eq(employeeBenefits.eligibilityStatus, "active")
        )
      );
    const benefitsAmount = round2(
      benefitRows
        .filter((b) => b.effectiveFrom <= periodEnd && (!b.effectiveTo || b.effectiveTo >= periodStart))
        .reduce((sum, b) => {
          const amount = Number(b.amount);
          if (b.frequency === "monthly") return sum + amount;
          if (b.frequency === "yearly") return sum + amount / 12;
          // one_time: only counts if it falls inside this period
          if (b.effectiveFrom >= periodStart && b.effectiveFrom <= periodEnd) return sum + amount;
          return sum;
        }, 0)
    );

    const grossPay = round2(proratedBasic + benefitsAmount + allowanceTotal);
    const netPay = round2(grossPay - deductionTotal);

    await db.insert(payrollLines).values({
      tenantId: session.tenantId,
      payrollRunId: run.id,
      employeeId: employee.id,
      basicSalary: basic.toFixed(2),
      workingDays: workingDays.toFixed(2),
      presentDays: presentDays.toFixed(2),
      absentDays: absentDays.toFixed(2),
      proratedBasic: proratedBasic.toFixed(2),
      allowances: allowanceTotal.toFixed(2),
      deductions: deductionTotal.toFixed(2),
      overtimeAmount: "0.00",
      benefitsAmount: benefitsAmount.toFixed(2),
      grossPay: grossPay.toFixed(2),
      netPay: netPay.toFixed(2),
    });
  }

  revalidatePath("/payroll/salary-sheet");
  revalidatePath(`/payroll/salary-sheet/${run.id}`);
  return run.id;
}

// Posts the ledger accrual for a run the moment it's finalized — one Salary
// Payable sub-account per employee is credited with their net pay, the
// shared Salary Expense account is debited with gross pay, and any
// deductions withheld go to a Payroll Deductions Payable liability. This
// runs exactly once per run, since a finalized run can never be
// regenerated or reverted back to draft (see generatePayrollRun /
// revertRunToDraft).
async function postPayrollAccrual(tenantId: string, run: typeof payrollRuns.$inferSelect, userId: string) {
  const lines = await db
    .select({
      employeeId: payrollLines.employeeId,
      grossPay: payrollLines.grossPay,
      deductions: payrollLines.deductions,
      netPay: payrollLines.netPay,
    })
    .from(payrollLines)
    .where(eq(payrollLines.payrollRunId, run.id));
  if (lines.length === 0) return;

  const employeeRows = await db
    .select({ id: employees.id, employeeCode: employees.employeeCode, fullName: employees.fullName, payableAccountId: employees.payableAccountId })
    .from(employees)
    .where(eq(employees.tenantId, tenantId));
  const employeeById = new Map(employeeRows.map((e) => [e.id, e]));

  const salaryExpense = await getOrCreateSalaryExpenseAccount(tenantId);
  const totalDeductions = lines.reduce((s, l) => s + Number(l.deductions), 0);
  const deductionsAccount = totalDeductions > 0 ? await getOrCreatePayrollDeductionsAccount(tenantId) : null;

  const postLines: PostLineInput[] = [];
  for (const line of lines) {
    const employee = employeeById.get(line.employeeId);
    if (!employee) continue;

    let payableAccountId = employee.payableAccountId;
    if (!payableAccountId) {
      const created = await createEmployeePayableAccount(tenantId, employee.fullName);
      payableAccountId = created.id;
      await db.update(employees).set({ payableAccountId }).where(eq(employees.id, employee.id));
    }

    const gross = Number(line.grossPay);
    const deductions = Number(line.deductions);
    const net = Number(line.netPay);
    if (gross <= 0) continue;

    postLines.push({ accountId: salaryExpense.id, debitAmount: gross, description: `Salary expense - ${employee.fullName}` });
    if (net > 0) {
      postLines.push({ accountId: payableAccountId, creditAmount: net, description: `Salary payable - ${employee.fullName}` });
    }
    if (deductions > 0 && deductionsAccount) {
      postLines.push({ accountId: deductionsAccount.id, creditAmount: deductions, description: `Payroll deductions - ${employee.fullName}` });
    }
  }
  if (postLines.length === 0) return;

  await postJournalEntry({
    tenantId,
    entryDate: run.periodEnd,
    sourceType: "payroll",
    sourceId: run.id,
    referenceNumber: `PR-${run.year}-${String(run.month).padStart(2, "0")}`,
    memo: `Payroll for ${run.year}-${String(run.month).padStart(2, "0")}`,
    createdBy: userId,
    lines: postLines,
  });
}

const STATUS_FLOW = ["draft", "review", "approved", "finalized"] as const;

export async function advanceRunStatus(input: { runId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.tenantId, session.tenantId)))
    .limit(1);
  if (!run) throw new Error("Payroll run not found");

  const currentIdx = STATUS_FLOW.indexOf(run.status);
  if (currentIdx === STATUS_FLOW.length - 1) throw new Error("This payroll run is already finalized");
  const nextStatus = STATUS_FLOW[currentIdx + 1];

  await db
    .update(payrollRuns)
    .set({ status: nextStatus, finalizedAt: nextStatus === "finalized" ? new Date() : null })
    .where(eq(payrollRuns.id, input.runId));

  if (nextStatus === "finalized") {
    await postPayrollAccrual(session.tenantId, run, session.userId);
  }

  await db.insert(auditLog).values({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "payroll_status_change",
    entityType: "payroll_run",
    entityId: input.runId,
    beforeValue: { status: run.status },
    afterValue: { status: nextStatus },
  });

  revalidatePath("/payroll/salary-sheet");
  revalidatePath(`/payroll/salary-sheet/${input.runId}`);
  if (nextStatus === "finalized") {
    revalidatePath("/journal");
    revalidatePath("/dashboard");
    revalidatePath("/chart-of-accounts");
  }
}

export async function revertRunToDraft(input: { runId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.tenantId, session.tenantId)))
    .limit(1);
  if (!run) throw new Error("Payroll run not found");
  if (run.status === "finalized") throw new Error("A finalized payroll run cannot be reverted");

  await db.update(payrollRuns).set({ status: "draft" }).where(eq(payrollRuns.id, input.runId));
  revalidatePath("/payroll/salary-sheet");
  revalidatePath(`/payroll/salary-sheet/${input.runId}`);
}
