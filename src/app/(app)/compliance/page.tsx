import { getComplianceDashboard } from "./actions";
import { ComplianceDashboard } from "./compliance-dashboard";

export default async function CompliancePage() {
  const data = await getComplianceDashboard();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Compliance</h1>
      <ComplianceDashboard data={data} />
    </div>
  );
}
