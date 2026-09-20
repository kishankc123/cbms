import { requireTenantSession } from "@/lib/session";
import { loadComplianceHistory } from "@/lib/compliance/history";
import { HistoryList } from "./history-list";

export default async function ComplianceHistoryPage() {
  const session = await requireTenantSession();
  const items = await loadComplianceHistory(session.tenantId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Compliance History</h1>
        <p className="mt-0.5 text-sm text-gray-500">What changed in your compliance information, from what to what, by whom and when. Nothing here is ever deleted when a current value changes.</p>
      </div>
      <HistoryList items={items} />
    </div>
  );
}
