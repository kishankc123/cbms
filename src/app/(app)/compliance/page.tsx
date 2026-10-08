import { guardView } from "@/components/page-guard";
import { getComplianceDashboard } from "./actions";
import { ComplianceDashboard } from "./compliance-dashboard";
import { ComplianceProfileNotice } from "./profile-notice";

export default async function CompliancePage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const data = await getComplianceDashboard();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Compliance</h1>
      <ComplianceProfileNotice />
      <ComplianceDashboard data={data} />
    </div>
  );
}
