import { guardView, guardSalary } from "@/components/page-guard";
import { requireTenantSession } from "@/lib/session";
import { getOrCreateSettings } from "@/lib/payroll/settings";
import { SettingsForm } from "./settings-form";
import { PageHeader } from "@/components/ui/page-header";

// How a payroll month is worked out: proration, working days, holidays, the pay period and rounding. Allowances and deductions are under Salary structure.
export default async function PayrollSettingsPage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const session = await requireTenantSession();
  const settings = await getOrCreateSettings(session.tenantId);

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll settings" className="!mb-0" />
      <SettingsForm settings={settings} />
    </div>
  );
}
