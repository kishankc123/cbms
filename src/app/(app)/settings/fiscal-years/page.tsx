import { requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { BackButton } from "@/components/ui/back-button";
import { getFiscalYearsPageData } from "./actions";
import { FiscalYearsManager } from "./fiscal-years-manager";

export default async function FiscalYearsPage() {
  const session = await requireTenantSession();
  const data = await getFiscalYearsPageData();

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <BackButton href="/settings" label="Back to Settings" />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Fiscal Years</h1>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Every fiscal year on record, its status, and the reporting/posting boundaries it defines.</p>
        </div>
      </div>
      <FiscalYearsManager data={data} isAdmin={isOrgAdmin(session.role)} />
    </div>
  );
}
