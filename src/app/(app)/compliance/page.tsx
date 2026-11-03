import { guardView } from "@/components/page-guard";
import { getComplianceDashboard } from "./actions";
import { ComplianceDashboard } from "./compliance-dashboard";
import { CatchupPrompt } from "./catchup-prompt";
import { ExcisePermitAlert } from "./excise-permit-alert";
import { ComplianceProfileNotice } from "./profile-notice";
import { PageHeader } from "@/components/ui/page-header";

export default async function CompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const sp = await searchParams;
  const data = await getComplianceDashboard(typeof sp.fy === "string" ? sp.fy : null);
  return (
    <div className="space-y-6">
      <PageHeader title="Compliance" className="!mb-0" />
      <ComplianceProfileNotice />
      <ExcisePermitAlert />
      <CatchupPrompt />
      <ComplianceDashboard data={data} />
    </div>
  );
}
