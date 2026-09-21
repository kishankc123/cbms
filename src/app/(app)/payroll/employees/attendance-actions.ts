"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, employees, payrollRuns } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export type AttendanceStatus = "present" | "absent" | "leave" | "half_day";

export async function setAttendance(input: { employeeId: string; date: string; status: AttendanceStatus }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(new Date(input.date + "T00:00:00Z").getTime())) throw new Error("Enter a valid date");
  if (!["present", "absent", "leave", "half_day"].includes(input.status)) throw new Error("Unknown attendance status");

  const [employee] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId))).limit(1);
  if (!employee) throw new Error("Employee not found");
  // Attendance in a period whose payroll has been finalized is history: change it by reversing that run first.
  const [finalized] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, session.tenantId), eq(payrollRuns.status, "finalized"), lte(payrollRuns.periodStart, input.date), gte(payrollRuns.periodEnd, input.date)))
    .limit(1);
  if (finalized) throw new Error("This date is in a finalized payroll run — reverse that run before changing its attendance");

  const [existing] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.tenantId, session.tenantId),
        eq(attendanceRecords.employeeId, input.employeeId),
        eq(attendanceRecords.date, input.date)
      )
    )
    .limit(1);

  if (existing) {
    await db.update(attendanceRecords).set({ status: input.status }).where(eq(attendanceRecords.id, existing.id));
  } else {
    await db.insert(attendanceRecords).values({
      tenantId: session.tenantId,
      employeeId: input.employeeId,
      date: input.date,
      status: input.status,
    });
  }

  revalidatePath(`/payroll/employees/${input.employeeId}`);
}
