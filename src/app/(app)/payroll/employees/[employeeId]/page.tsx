import { guardView } from "@/components/page-guard";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { employeeRetirement, tenants, employees, salaryHistory, employeeBenefits, employeeComponents, payrollComponents, attendanceRecords, payrollLines, payrollRuns, users } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { todayIso, ymdOf } from "@/lib/calendar";
import { getCurrentSalary } from "@/lib/payroll/salary";
import { listEmployeeAdvances } from "@/lib/payroll/staff-advances";
import { ProfileTabs } from "./profile-tabs";
import { payrollRulesOn } from "@/lib/payroll/platform-rules";
import { enrolmentsOn, enrolmentWarnings, type Enrolment } from "@/lib/payroll/employee-retirement";
import type { EmployeeScheme } from "@/lib/payroll/retirement-rules";
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
        tdsAmount: payrollLines.tdsAmount,
        tdsDetail: payrollLines.tdsDetail,
        netPay: payrollLines.netPay,
      })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
      .where(
        and(eq(payrollLines.tenantId, session.tenantId), eq(payrollLines.employeeId, employeeId), eq(payrollRuns.status, "finalized"))
      )
      .orderBy(desc(payrollRuns.periodStart)),
    listEmployeeAdvances(session.tenantId, employeeId),
    db.select().from(payrollComponents).where(eq(payrollComponents.tenantId, session.tenantId)).orderBy(payrollComponents.name),
    db.select().from(employeeComponents).where(and(eq(employeeComponents.tenantId, session.tenantId), eq(employeeComponents.employeeId, employeeId))).orderBy(desc(employeeComponents.effectiveFrom)),
    db.select().from(employeeRetirement).where(and(eq(employeeRetirement.tenantId, session.tenantId), eq(employeeRetirement.employeeId, employeeId))).orderBy(desc(employeeRetirement.startDate)),
    db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
    ]);

  const [attendanceRows, pay] = await Promise.all([db.select().from(attendanceRecords).where(and(eq(attendanceRecords.tenantId, session.tenantId), eq(attendanceRecords.employeeId, employeeId))), seesPay ? loadPay() : Promise.resolve(null)]);
  const [currentSalary, salaryRows, benefitRows, payslipRows, advanceRows, componentCatalog, componentAssignments, retirementRows, tenantRows] = pay ?? [null, [], [], [], [], [], [], [], []];

  // The payroll rules in force today for the organization's country, and anything worth a look about this employee's enrolment.
  const today = todayIso();
  const rulesNow = seesPay && tenantRows[0]?.countryCode ? await payrollRulesOn(tenantRows[0].countryCode, today) : null;
  const enrolments: Enrolment[] = retirementRows.map((r) => ({ id: r.id, scheme: r.scheme as EmployeeScheme, registrationNumber: r.registrationNumber, startDate: r.startDate, endDate: r.endDate, citMode: r.citMode === "percent" ? "percent" : r.citMode === "fixed" ? "fixed" : null, citValue: r.citValue === null ? null : Number(r.citValue), citEmployerValue: r.citEmployerValue === null ? null : Number(r.citEmployerValue) }));
  const retirementWarnings = enrolmentWarnings(enrolments, employee, rulesNow?.rules ?? null, today);
  const canExempt = enrolmentsOn(enrolments, today).some((e) => e.scheme === "ssf" && Boolean(rulesNow?.rules.schemes.ssf.sstExemptionPossible));

  const attendanceMap: Record<string, AttendanceStatus> = {};
  for (const r of attendanceRows) attendanceMap[r.date] = r.status as AttendanceStatus;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">{employee.fullName}</h1>
        <p className="text-sm text-gray-500">{employee.employeeCode}</p>
      </div>

      <ProfileTabs
        employee={employee}
        currentSalary={seesPay ? currentSalary ?? 0 : null}
        salaryRecords={salaryRows.map((r) => ({ ...r, createdByName: r.createdByName ?? "—", createdAt: r.createdAt.toISOString() }))}
        benefits={benefitRows}
        componentCatalog={componentCatalog}
        componentAssignments={componentAssignments}
        retirementRows={retirementRows}
        retirementWarnings={retirementWarnings}
        rulesInForce={rulesNow ? { verified: rulesNow.isVerified } : null}
        canExempt={canExempt}
        attendanceMonth={month}
        attendanceYear={year}
        attendanceRecords={attendanceMap}
        payslips={payslipRows}
        advances={advanceRows}
      />
    </div>
  );
}
