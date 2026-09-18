import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollRuns } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { SalarySheetTabs } from "./salary-sheet-tabs";

export default async function SalarySheetPage() {
  const session = await requireTenantSession();

  const [runs, employeeList] = await Promise.all([
    db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.tenantId, session.tenantId))
      .orderBy(desc(payrollRuns.year), desc(payrollRuns.month)),
    db.select().from(employees).where(eq(employees.tenantId, session.tenantId)).orderBy(asc(employees.employeeCode)),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Salary sheet</h1>
      <SalarySheetTabs runs={runs} employees={employeeList} />
    </div>
  );
}
