import { requireTenantSession, can } from "@/lib/session";
import { bankReconciliationReport } from "@/lib/banking/reconciliation-report";
import { BankReconciliationReportView } from "./bank-reconciliation-report-view";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";

export default async function BankReconciliationReportPage() {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const rows = await bankReconciliationReport(session.tenantId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <PageHeader title="Bank Reconciliation Report" className="!mb-0" />
      </div>
      <BankReconciliationReportView rows={rows} />
    </div>
  );
}
