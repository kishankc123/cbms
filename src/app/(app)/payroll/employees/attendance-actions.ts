"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export type AttendanceStatus = "present" | "absent" | "leave" | "half_day";

export async function setAttendance(input: { employeeId: string; date: string; status: AttendanceStatus }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");

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
