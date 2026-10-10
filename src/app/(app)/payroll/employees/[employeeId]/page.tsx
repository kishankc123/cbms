import { guardView } from "@/components/page-guard";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { employees, salaryHistory, employeeBenefits, attendanceRecords, payrollLines, payrollRuns, users } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { todayIso, ymdOf } from "@/lib/calendar";
import { getCurrentSalary } from "@/lib/payroll/salary";
import { listEmployeeAdvances } from "@/lib/payroll/staff-advances";
import { ProfileTabs } from "./profile-tabs";
import type { AttendanceStatus } from "../attendance-actions";

export default async function EmployeeProfilePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const denied = await guardView("payroll");
  if (denied) return denied;
  const { employeeId } = await params;
  const session = await requireTenantSession();

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, session.tenantId)))
    .limit(1);
  if (!employee) {
    return <p className="text-sm text-red-600">Employee not found.</p>;
  }

  // The attendance month opens on the current month of the organization's calendar.
  const current = ymdOf(session.calendar, todayIso()) ?? ymdOf("AD", todayIso())!;
  const month = current.month;
  const year = current.year;

  // Pay (salary, benefits, payslips, advances) is only read for a role that may see salary amounts; everyone with Payroll View gets the
  // profile and attendance.
  const seesPay = can(session, "payroll", "view_salary");
  const loadPay = () =>
    Promise.all([
    getCurrentSalary(session.tenantId, employeeId),
    db
      .select({
        id: salaryHistory.id,
        effectiveFrom: salaryHistory.effectiveFrom,
        basicSalary: salaryHistory.basicSalary,
        changeType: salaryHistory.changeType,
        previousSalary: salaryHistory.previousSalary,
        changeAmount: salaryHistory.changeAmount,
        changePercentage: salaryHistory.changePercentage,
        reason: salaryHistory.reason,
        notes: salaryHistory.notes,
        createdAt: salaryHistory.createdAt,
        createdByName: users.name,
      })
      .from(salaryHistory)
      .leftJoin(users, eq(users.id, salaryHistory.createdBy))
      .where(and(eq(salaryHistory.tenantId, session.tenantId), eq(salaryHistory.employeeId, employeeId)))
      .orderBy(desc(salaryHistory.effectiveFrom)),
    db
      .select()
      .from(employeeBenefits)
      .where(and(eq(employeeBenefits.tenantId, session.tenantId), eq(employeeBenefits.employeeId, employeeId)))
      .orderBy(desc(employeeBenefits.effectiveFrom)),
    db
      .select({
        id: payrollLines.id,
        calendarSystem: payrollRuns.calendarSystem,
        month: payrollRuns.month,
        year: payrollRuns.year,
        status: payrollRuns.status,
        basicSalary: payrollLines.basicSalary,
        grossPay: payrollLines.grossPay,
        advanceRecovered: payrollLines.advanceRecovered,
        netPay: payrollLines.netPay,
      })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
      .where(
        and(eq(payrollLines.tenantId, session.tenantId), eq(payrollLines.employeeId, employeeId), eq(payrollRuns.status, "finalized"))
      )
      .orderBy(desc(payrollRuns.periodStart)),
    listEmployeeAdvances(session.tenantId, employeeId),
    ]);

  const [attendanceRows, pay] = await Promise.all([db.select().from(attendanceRecords).where(and(eq(attendanceRecords.tenantId, session.tenantId), eq(attendanceRecords.employeeId, employeeId))), seesPay ? loadPay() : Promise.resolve(null)]);
  const [currentSalary, salaryRows, benefitRows, payslipRows, advanceRows] = pay ?? [null, [], [], [], []];

  const attendanceMap: Record<string, AttendanceStatus> = {};
  for (const r of attendanceRows) attendanceMap[r.date] = r.status as AttendanceStatus;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{employee.fullName}</h1>
        <p className="text-sm text-gray-500">{employee.employeeCode}</p>
      </div>

      <ProfileTabs
        employee={employee}
        currentSalary={seesPay ? currentSalary ?? 0 : null}
        salaryRecords={salaryRows.map((r) => ({ ...r, createdByName: r.createdByName ?? "—", createdAt: r.createdAt.toISOString() }))}
        benefits={benefitRows}
        attendanceMonth={month}
        attendanceYear={year}
        attendanceRecords={attendanceMap}
        payslips={payslipRows}
        advances={advanceRows}
      />
    </div>
  );
}
