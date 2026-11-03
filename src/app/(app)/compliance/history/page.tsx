import { guardView } from "@/components/page-guard";
import { requireTenantSession } from "@/lib/session";
import { loadComplianceHistory } from "@/lib/compliance/history";
import { HistoryList } from "./history-list";
import { PageHeader } from "@/components/ui/page-header";

export default async function ComplianceHistoryPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const session = await requireTenantSession();
  const items = await loadComplianceHistory(session.tenantId);
  return (
    <div className="space-y-6">
      <PageHeader title="Compliance History" description="What changed in your compliance information, from what to what, by whom and when. Nothing here is ever deleted when a current value changes." />
      <HistoryList items={items} />
    </div>
  );
}
