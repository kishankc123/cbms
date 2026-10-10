import { guardView } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, salaryHistory } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { EmployeesTabs } from "./employees-tabs";

import { todayIso } from "@/lib/calendar";
export default async function EmployeesPage() {
  const denied = await guardView("payroll");
  if (denied) return denied;
  const session = await requireTenantSession();
  const today = todayIso();

  // Pay is only read for a role that may see it; without it the salary column and Add new (which sets a salary) are left out.
  const seesSalary = can(session, "payroll", "view_salary");
  const [employeeList, salaryRows] = await Promise.all([
    db.select().from(employees).where(eq(employees.tenantId, session.tenantId)).orderBy(asc(employees.employeeCode)),
    seesSalary ? db.select().from(salaryHistory).where(eq(salaryHistory.tenantId, session.tenantId)) : Promise.resolve([]),
  ]);

  // Latest salary per employee as of today — the same effective-dated lookup
  // used everywhere else, just batched for the list view.
  const latestEffectiveFrom = new Map<string, string>();
  const currentSalaryByEmployee = new Map<string, number>();
  for (const row of salaryRows) {
    if (row.effectiveFrom > today) continue;
    const currentBest = latestEffectiveFrom.get(row.employeeId);
    if (!currentBest || row.effectiveFrom > currentBest) {
      latestEffectiveFrom.set(row.employeeId, row.effectiveFrom);
      currentSalaryByEmployee.set(row.employeeId, Number(row.basicSalary));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Employees</h1>
      <EmployeesTabs
        employees={employeeList}
        currentSalaries={seesSalary ? Object.fromEntries(currentSalaryByEmployee) : null}
      />
    </div>
  );
}
