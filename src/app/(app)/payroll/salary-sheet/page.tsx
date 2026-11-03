import { guardView, guardSalary } from "@/components/page-guard";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollRuns } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { SalarySheetTabs } from "./salary-sheet-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default async function SalarySheetPage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const session = await requireTenantSession();

  const [runs, employeeList] = await Promise.all([
    db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.tenantId, session.tenantId))
      .orderBy(desc(payrollRuns.periodStart)),
    db.select().from(employees).where(eq(employees.tenantId, session.tenantId)).orderBy(asc(employees.employeeCode)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Salary sheet" className="!mb-0" />
      <SalarySheetTabs runs={runs} employees={employeeList} />
    </div>
  );
}
