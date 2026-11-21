import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { attendanceChecks, attendanceEvents, attendanceRecords, employees, payrollRuns, users } from "@/db/schema";
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
  // A change in a month that was already checked goes into that month's history.
  const [checkedMonth] = await db
    .select({ periodStart: attendanceChecks.periodStart })
    .from(attendanceChecks)
    .where(and(eq(attendanceChecks.tenantId, tenantId), lte(attendanceChecks.periodStart, input.date), gte(attendanceChecks.periodEnd, input.date)))
    .limit(1);
  if (checkedMonth) {
    const [was] = await db.select({ status: attendanceRecords.status }).from(attendanceRecords).where(where).limit(1);
    const from = was?.status ?? "present";
    if (from !== input.status) await db.insert(attendanceEvents).values({ tenantId, periodStart: checkedMonth.periodStart, kind: "mark_changed", employeeId: input.employeeId, workDate: input.date, fromStatus: from, toStatus: input.status, byUser: userId });
  }
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
  await db.insert(attendanceEvents).values({ tenantId, periodStart, kind: "checked", byUser: userId });
  await logAuditEvent({ tenantId, userId, action: "attendance_checked", entityType: "attendance_month", after: { periodStart, periodEnd } });
}

/** Takes the check off a month. A reason is required, and it stays in the month's history together with who checked it and when. */
export async function unmarkMonthChecked(tenantId: string, userId: string, periodStart: string, reason: string) {
  const why = reason.trim();
  if (why.length < 3) fail("Give a short reason for undoing the check.");
  const [was] = await db.select({ id: attendanceChecks.id }).from(attendanceChecks).where(and(eq(attendanceChecks.tenantId, tenantId), eq(attendanceChecks.periodStart, periodStart))).limit(1);
  if (!was) fail("This month is not marked as checked.");
  await db.delete(attendanceChecks).where(and(eq(attendanceChecks.tenantId, tenantId), eq(attendanceChecks.periodStart, periodStart)));
  await db.insert(attendanceEvents).values({ tenantId, periodStart, kind: "check_undone", reason: why, byUser: userId });
  await logAuditEvent({ tenantId, userId, action: "attendance_check_removed", entityType: "attendance_month", after: { periodStart, reason: why } });
}

export type AttendanceHistoryItem = { id: string; kind: string; at: string; by: string; employee: string | null; workDate: string | null; from: string | null; to: string | null; reason: string | null };

/** The history of one month's attendance, newest first. */
export async function loadAttendanceHistory(tenantId: string, periodStart: string): Promise<AttendanceHistoryItem[]> {
  const rows = await db
    .select({ e: attendanceEvents, by: users.name, employee: employees.fullName })
    .from(attendanceEvents)
    .leftJoin(users, eq(users.id, attendanceEvents.byUser))
    .leftJoin(employees, eq(employees.id, attendanceEvents.employeeId))
    .where(and(eq(attendanceEvents.tenantId, tenantId), eq(attendanceEvents.periodStart, periodStart)))
    .orderBy(desc(attendanceEvents.at));
  return rows.map((r) => ({ id: r.e.id, kind: r.e.kind, at: r.e.at.toISOString(), by: r.by ?? "", employee: r.employee, workDate: r.e.workDate, from: r.e.fromStatus, to: r.e.toStatus, reason: r.e.reason }));
}
