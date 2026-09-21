"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeeBenefits, attendanceRecords, payrollComponents, payrollRuns, payrollLines, auditLog } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { computeBasicForPeriod } from "@/lib/payroll/salary";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
import { daysInMonth as calendarDaysInMonth, isoFromYmd, type CalendarSystem } from "@/lib/calendar";
import { getOrCreateSettings } from "../setup/actions";
import { reverseJournalEntry } from "@/lib/ledger/post";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { postPayrollAccrual, activePayrollEntries, getEmployeePayableBalance } from "@/lib/payroll/accrual";
import { todayIso } from "@/lib/calendar";

const round2 = (n: number) => Math.round(n * 100) / 100;

// The payroll month is a month of the organization's calendar: a BS run for
// Ashwin 2083 covers the real Ashwin days (29–32 of them). What is stored and
// calculated on is the pair of real AD dates it maps to.
function periodForMonth(calendar: CalendarSystem, year: number, month: number, startDay: number, endDay: number) {
  const lastDay = calendarDaysInMonth(calendar, year, month);
  if (!lastDay) throw new Error("That month is outside the supported calendar range");
  const start = Math.min(Math.max(startDay, 1), lastDay);
  const end = Math.min(Math.max(endDay, start), lastDay);
  const periodStart = isoFromYmd(calendar, { year, month, day: start });
  const periodEnd = isoFromYmd(calendar, { year, month, day: end });
  if (!periodStart || !periodEnd) throw new Error("Invalid payroll month");
  return { periodStart, periodEnd };
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
  /** Calendar the month/year are in; defaults to the organization's. Pass a run's own calendar when regenerating it. */
  calendar?: CalendarSystem;
  employeeIds: string[]; // empty = all active employees
};

// Recomputes a payroll run's lines from the salary/benefits/attendance
// applicable to the selected period — never from the employee's "current"
// salary. Blocked once the run is finalized, per the immutability rule.
export async function generatePayrollRun(input: GenerateRunInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");

  const settings = await getOrCreateSettings(session.tenantId);
  const calendar: CalendarSystem = input.calendar ?? session.calendar;
  const { periodStart, periodEnd } = periodForMonth(calendar, input.year, input.month, settings.payrollStartDay, settings.payrollEndDay);

  const [existingRun] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, session.tenantId), eq(payrollRuns.month, input.month), eq(payrollRuns.year, input.year), eq(payrollRuns.calendarSystem, calendar)))
    .limit(1);
  if (existingRun && existingRun.status === "finalized") {
    throw new Error("This payroll period is already finalized and cannot be regenerated");
  }
  // Two runs can't cover the same days — not even one made in AD and one in BS for the same real month.
  const overlapping = await db
    .select()
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.tenantId, session.tenantId),
        lte(payrollRuns.periodStart, periodEnd),
        gte(payrollRuns.periodEnd, periodStart),
        ...(existingRun ? [ne(payrollRuns.id, existingRun.id)] : [])
      )
    )
    .limit(1);
  if (overlapping[0]) throw new Error(`This overlaps the payroll run for ${payrollPeriodLabel(overlapping[0])} (${overlapping[0].periodStart} to ${overlapping[0].periodEnd})`);

  // Who is paid: everyone who was employed at some point in the period — joined on or before its last day and had not
  // left before its first. (Without a selection, that means active staff plus anyone who left during the period.)
  const everyone = await db
    .select()
    .from(employees)
    .where(and(eq(employees.tenantId, session.tenantId), ...(input.employeeIds.length > 0 ? [inArray(employees.id, input.employeeIds)] : [])));
  const employeeList = everyone
    .filter((e) => (input.employeeIds.length > 0 ? true : e.employmentStatus === "active" || Boolean(e.leavingDate && e.leavingDate >= periodStart)))
    .filter((e) => e.joiningDate <= periodEnd && (!e.leavingDate || e.leavingDate >= periodStart));
  if (employeeList.length === 0) throw new Error("No employees were employed during this period, so there is nothing to include in this payroll run");

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
        .values({ tenantId: session.tenantId, calendarSystem: calendar, month: input.month, year: input.year, periodStart, periodEnd, createdBy: session.userId })
        .returning()
    )[0];

  // Regenerating puts a run that had moved on (review / approved) back to draft: its numbers are new.
  if (existingRun && existingRun.status !== "draft") await db.update(payrollRuns).set({ status: "draft" }).where(eq(payrollRuns.id, run.id));
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

    // The days of the period this person was actually employed: from their joining date, up to the day they left.
    const employedFrom = employee.joiningDate > periodStart ? employee.joiningDate : periodStart;
    const employedTo = employee.leavingDate && employee.leavingDate < periodEnd ? employee.leavingDate : periodEnd;

    let workingDays = 0;
    let employedWorkingDays = 0;
    let presentDays = 0;
    for (const dateStr of periodDates) {
      const dayOfWeek = new Date(dateStr + "T00:00:00Z").getUTCDay();
      const isHoliday =
        settings.workingDaysMethod === "exclude_weekly_holidays" && (weeklyHolidaySet.has(dayOfWeek) || publicHolidaySet.has(dateStr));
      if (!isHoliday) workingDays++;
      if (isHoliday || dateStr < employedFrom || dateStr > employedTo) continue;
      employedWorkingDays++;

      const status = attendanceByDate.get(dateStr) ?? "present";
      if (status === "present") presentDays += 1;
      else if (status === "half_day") presentDays += 0.5;
      // absent / leave contribute 0
    }
    if (workingDays === 0) workingDays = totalPeriodDays;
    // Absent means absent while employed; days before joining or after leaving are simply not part of the pay.
    const absentDays = round2(Math.max(employedWorkingDays - presentDays, 0));

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

  if (nextStatus === "finalized") {
    // The salary entry is posted FIRST (and refused up front when the period is closed or there is nothing to post), and the
    // run is only marked finalized once it exists — a run can never be finalized with no accounting behind it.
    await assertPeriodOpen(session.tenantId, run.periodEnd);
    const entryId = await postPayrollAccrual(session.tenantId, run, session.userId);
    try {
      await db.update(payrollRuns).set({ status: "finalized", finalizedAt: new Date() }).where(eq(payrollRuns.id, input.runId));
    } catch (e) {
      await reverseJournalEntry(session.tenantId, entryId, session.userId, "Rolled back — the run could not be finalized").catch(() => {});
      throw e;
    }
  } else {
    await db.update(payrollRuns).set({ status: nextStatus, finalizedAt: null }).where(eq(payrollRuns.id, input.runId));
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

/**
 * Takes a finalized run back to draft so it can be corrected: its salary entry is reversed and the run reopens. Refused
 * when an employee's salary payable no longer covers what this run credited them (they have been paid out of it), so
 * the payable can never go negative; a reason is required and recorded.
 */
export async function reverseFinalizedRun(input: { runId: string; reason: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (!input.reason.trim()) throw new Error("A reason is required to reverse a finalized payroll run");

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.tenantId, session.tenantId)))
    .limit(1);
  if (!run) throw new Error("Payroll run not found");
  if (run.status !== "finalized") throw new Error("Only a finalized payroll run can be reversed");

  const entries = await activePayrollEntries(session.tenantId, run.id);
  if (entries.length > 0) {
    const lines = await db.select().from(payrollLines).where(eq(payrollLines.payrollRunId, run.id));
    for (const line of lines) {
      const net = Number(line.netPay);
      if (net <= 0) continue;
      const balance = await getEmployeePayableBalance(session.tenantId, line.employeeId);
      if (balance + 0.005 < net) {
        const [emp] = await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, line.employeeId)).limit(1);
        throw new Error(`${emp?.name ?? "An employee"} has already been paid out of this run (payable ${balance.toFixed(2)} of ${net.toFixed(2)}) — void those salary payments first`);
      }
    }
    await assertPeriodOpen(session.tenantId, todayIso());
    for (const entry of entries) {
      await reverseJournalEntry(session.tenantId, entry.id, session.userId, `Payroll run reversed: ${input.reason.trim()}`);
    }
  }

  await db.update(payrollRuns).set({ status: "draft", finalizedAt: null }).where(eq(payrollRuns.id, run.id));
  await db.insert(auditLog).values({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "payroll_run_reversed",
    entityType: "payroll_run",
    entityId: run.id,
    beforeValue: { status: "finalized" },
    afterValue: { status: "draft", reason: input.reason.trim() },
  });

  for (const p of ["/payroll/salary-sheet", `/payroll/salary-sheet/${run.id}`, "/journal", "/dashboard", "/chart-of-accounts"]) revalidatePath(p);
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
