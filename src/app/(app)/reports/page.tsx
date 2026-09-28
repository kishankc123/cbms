import { requireTenantSession } from "@/lib/session";
import { REPORT_CATALOG } from "./report-catalog";
import { ReportsLanding } from "./reports-landing";

export default async function ReportsPage() {
  await requireTenantSession();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
        <p className="mt-0.5 text-sm text-gray-500">Every report reads from the same posted General Ledger — nothing here recalculates on its own.</p>
      </div>
      <ReportsLanding categories={REPORT_CATALOG} />
    </div>
  );
}
