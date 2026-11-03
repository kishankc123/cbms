import { guardView, guardSalary } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollComponents } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getOrCreateSettings } from "@/lib/payroll/settings";
import { SetupTabs } from "./setup-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default async function PayrollSetupPage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const session = await requireTenantSession();

  const [settings, components] = await Promise.all([
    getOrCreateSettings(session.tenantId),
    db.select().from(payrollComponents).where(eq(payrollComponents.tenantId, session.tenantId)).orderBy(asc(payrollComponents.name)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll setup" className="!mb-0" />
      <SetupTabs settings={settings} components={components} />
    </div>
  );
}
