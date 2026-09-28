import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { bankReconciliationReport } from "@/lib/banking/reconciliation-report";
import { BankReconciliationReportView } from "./bank-reconciliation-report-view";

export default async function BankReconciliationReportPage() {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const rows = await bankReconciliationReport(session.tenantId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Bank Reconciliation Report</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <BankReconciliationReportView rows={rows} />
    </div>
  );
}
