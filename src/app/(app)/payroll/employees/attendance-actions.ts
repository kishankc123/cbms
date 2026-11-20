"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import type { CalendarSystem } from "@/lib/calendar";
import { AttendanceError, attendanceCheckedFor, markAttendance, markMonthChecked, unmarkMonthChecked } from "@/lib/payroll/attendance";

export type AttendanceStatus = "present" | "absent" | "leave" | "half_day";

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AttendanceError) throw new Error(e.message);
    throw e;
  }
}

/** Marks one employee's day. The rules (joining and leaving dates, no future days, finalized months) are in lib/payroll/attendance.ts. */
export async function setAttendance(input: { employeeId: string; date: string; status: AttendanceStatus }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  await run(() => markAttendance(session.tenantId, session.userId, input));
  revalidatePath(`/payroll/employees/${input.employeeId}`);
  revalidatePath("/payroll/attendance");
}

/** Records that someone looked over a month's attendance, so payroll does not warn about it. */
export async function markAttendanceChecked(input: { periodStart: string; periodEnd: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  await run(() => markMonthChecked(session.tenantId, session.userId, input.periodStart, input.periodEnd));
  revalidatePath("/payroll/attendance");
  revalidatePath("/payroll/salary-sheet");
}

export async function clearAttendanceCheck(input: { periodStart: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  await run(() => unmarkMonthChecked(session.tenantId, session.userId, input.periodStart));
  revalidatePath("/payroll/attendance");
  revalidatePath("/payroll/salary-sheet");
}

/** For the warning before a payroll run is generated: was this month's attendance checked? */
export async function getAttendanceCheckNotice(input: { month: number; year: number; calendar: CalendarSystem }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "view")) throw new Error("Not permitted");
  const r = await attendanceCheckedFor(session.tenantId, input.calendar, input.year, input.month);
  return { checked: Boolean(r.checked), periodStart: r.periodStart, periodEnd: r.periodEnd };
}
