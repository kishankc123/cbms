import { guardView, guardSalary } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollComponents } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { ComponentsPanel } from "../setup/components-panel";

// The allowances and deductions an organization pays, and how each is worked out. Each employee gets the ones assigned to them on their profile.
export default async function SalaryStructurePage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const session = await requireTenantSession();
  const components = await db.select().from(payrollComponents).where(eq(payrollComponents.tenantId, session.tenantId)).orderBy(asc(payrollComponents.name));

  return (
    <div className="space-y-6">
      <PageHeader title="Salary structure" className="!mb-0" />
      <ComponentsPanel components={components} />
    </div>
  );
}
