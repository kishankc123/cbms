import { guardView } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollComponents } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getOrCreateSettings } from "@/lib/payroll/settings";
import { SetupTabs } from "./setup-tabs";

export default async function PayrollSetupPage() {
  const denied = await guardView("payroll");
  if (denied) return denied;
  const session = await requireTenantSession();

  const [settings, components] = await Promise.all([
    getOrCreateSettings(session.tenantId),
    db.select().from(payrollComponents).where(eq(payrollComponents.tenantId, session.tenantId)).orderBy(asc(payrollComponents.name)),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Payroll setup</h1>
      <SetupTabs settings={settings} components={components} />
    </div>
  );
}
