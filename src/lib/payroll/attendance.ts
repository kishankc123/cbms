import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { attendanceChecks, attendanceRecords, employees, payrollRuns, users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { todayIso, weekdayOf, ymdOf, type CalendarSystem } from "@/lib/calendar";
import { getOrCreateSettings } from "./settings";
import { eachDate, periodForMonth } from "./period";
import { markProblem, type AttendanceStatus } from "./attendance-rules";

// Attendance for a payroll month: who, which days, what was marked, and whether the month was checked. Plain server helpers; the actions check the
// permission first. Only the exceptions are stored: a day nobody marked is present, and marking a day present again removes the record.

export type AttendanceMonth = {
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  days: { iso: string; day: number; holiday: boolean }[];
  employees: { id: string; code: string; name: string; joiningDate: string; leavingDate: string | null }[];
  records: Record<string, Record<string, AttendanceStatus>>;
  /** The payroll run for this month has been finalized: its attendance can't be changed. */
  locked: boolean;
  checked: { at: string; by: string } | null;
};

export async function loadAttendanceMonth(tenantId: string, calendar: CalendarSystem, year: number, month: number): Promise<AttendanceMonth> {
  const settings = await getOrCreateSettings(tenantId);
  const { periodStart, periodEnd } = periodForMonth(calendar, year, month, settings.payrollStartDay, settings.payrollEndDay);
  const weekly = new Set(settings.weeklyHolidays);
  const pub = new Set(settings.publicHolidays);
  const excludes = settings.workingDaysMethod === "exclude_weekly_holidays";
  const days = eachDate(periodStart, periodEnd).map((iso) => ({ iso, day: ymdOf(calendar, iso)?.day ?? 0, holiday: excludes && (weekly.has(weekdayOf(iso)) || pub.has(iso)) }));

  // The same people payroll would pay: employed at some point in the period.
  const everyone = await db.select().from(employees).where(eq(employees.tenantId, tenantId)).orderBy(asc(employees.employeeCode));
  const list = everyone
    .filter((e) => e.joiningDate <= periodEnd && (!e.leavingDate || e.leavingDate >= periodStart))
    .filter((e) => e.employmentStatus === "active" || Boolean(e.leavingDate && e.leavingDate >= periodStart));

  const rows = await db
    .select({ employeeId: attendanceRecords.employeeId, date: attendanceRecords.date, status: attendanceRecords.status })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.tenantId, tenantId), gte(attendanceRecords.date, periodStart), lte(attendanceRecords.date, periodEnd)));
  const records: AttendanceMonth["records"] = {};
  for (const r of rows) if (r.status !== "present") (records[r.employeeId] ??= {})[r.date] = r.status;

  const [finalized] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized"), lte(payrollRuns.periodStart, periodEnd), gte(payrollRuns.periodEnd, periodStart)))
    .limit(1);

  return {
    year,
    month,
    periodStart,
    periodEnd,
    days,
    employees: list.map((e) => ({ id: e.id, code: e.employeeCode, name: e.fullName, joiningDate: e.joiningDate, leavingDate: e.leavingDate })),
    records,
    locked: Boolean(finalized),
    checked: await checkOf(tenantId, periodStart),
  };
}

async function checkOf(tenantId: string, periodStart: string): Promise<{ at: string; by: string } | null> {
  const [row] = await db
    .select({ at: attendanceChecks.checkedAt, by: users.name })
    .from(attendanceChecks)
    .leftJoin(users, eq(users.id, attendanceChecks.checkedBy))
    .where(and(eq(attendanceChecks.tenantId, tenantId), eq(attendanceChecks.periodStart, periodStart)))
    .limit(1);
  return row ? { at: row.at.toISOString().slice(0, 10), by: row.by ?? "" } : null;
}

/** Whether the attendance of a payroll month was marked as checked: for the warning when payroll is generated. */
export async function attendanceCheckedFor(tenantId: string, calendar: CalendarSystem, year: number, month: number) {
  const settings = await getOrCreateSettings(tenantId);
  const { periodStart, periodEnd } = periodForMonth(calendar, year, month, settings.payrollStartDay, settings.payrollEndDay);
  return { periodStart, periodEnd, checked: await checkOf(tenantId, periodStart) };
}

export class AttendanceError extends Error {}
const fail = (message: string): never => {
  throw new AttendanceError(message);
};

/** Marks one person's day. Refused for a day outside their employment, a day to come, and a month whose payroll is finalized. */
export async function markAttendance(tenantId: string, userId: string, input: { employeeId: string; date: string; status: AttendanceStatus }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(new Date(input.date + "T00:00:00Z").getTime())) fail("Enter a valid date");
  if (!["present", "absent", "leave", "half_day"].includes(input.status)) fail("Unknown attendance status");

  const [employee] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, tenantId))).limit(1);
  if (!employee) return fail("Employee not found");
  // Attendance in a period whose payroll has been finalized is history: change it by reversing that run first.
  const [finalized] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized"), lte(payrollRuns.periodStart, input.date), gte(payrollRuns.periodEnd, input.date)))
    .limit(1);
  if (finalized) fail("This date is in a finalized payroll run — reverse that run before changing its attendance");
  const problem = markProblem({ fullName: employee.fullName, joiningDate: employee.joiningDate, leavingDate: employee.leavingDate }, input.date, todayIso());
  if (problem) fail(problem);

  const where = and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.employeeId, input.employeeId), eq(attendanceRecords.date, input.date));
  if (input.status === "present") {
    await db.delete(attendanceRecords).where(where);
    return;
  }
  const [existing] = await db.select({ id: attendanceRecords.id }).from(attendanceRecords).where(where).limit(1);
  if (existing) await db.update(attendanceRecords).set({ status: input.status }).where(and(eq(attendanceRecords.id, existing.id), eq(attendanceRecords.tenantId, tenantId)));
  else await db.insert(attendanceRecords).values({ tenantId, employeeId: input.employeeId, date: input.date, status: input.status });
}

/** Records that someone looked over this month's attendance. Only a month that has started can be checked. */
export async function markMonthChecked(tenantId: string, userId: string, periodStart: string, periodEnd: string) {
  if (periodStart > todayIso()) fail("That month hasn't started yet, so there is nothing to check.");
  await db
    .insert(attendanceChecks)
    .values({ tenantId, periodStart, periodEnd, checkedBy: userId })
    .onConflictDoUpdate({ target: [attendanceChecks.tenantId, attendanceChecks.periodStart], set: { periodEnd, checkedBy: userId, checkedAt: new Date() } });
  await logAuditEvent({ tenantId, userId, action: "attendance_checked", entityType: "attendance_month", after: { periodStart, periodEnd } });
}

export async function unmarkMonthChecked(tenantId: string, userId: string, periodStart: string) {
  await db.delete(attendanceChecks).where(and(eq(attendanceChecks.tenantId, tenantId), eq(attendanceChecks.periodStart, periodStart)));
  await logAuditEvent({ tenantId, userId, action: "attendance_check_removed", entityType: "attendance_month", after: { periodStart } });
}
