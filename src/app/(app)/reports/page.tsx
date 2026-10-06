import { can, requireTenantSession } from "@/lib/session";
import { REPORT_CATALOG } from "./report-catalog";
import { ReportsLanding } from "./reports-landing";

// The module whose View each report needs, matching the check inside the report page itself. The landing page only
// lists what the person can open (each report still checks for itself: this is a convenience, not the protection).
const REPORT_MODULE: Record<string, string> = {
  "balance-sheet": "chart_of_accounts",
  "bank-book": "bank_reconciliation",
  "bank-reconciliation-report": "bank_reconciliation",
  "cash-bank-movement": "bank_reconciliation",
  "cash-book": "bank_reconciliation",
  "cash-flow": "chart_of_accounts",
  "customer-statement": "sales",
  "journal-report": "chart_of_accounts",
  ledger: "chart_of_accounts",
  "payable-ageing": "purchases",
  "payroll-summary": "payroll",
  "profit-and-loss": "chart_of_accounts",
  "purchase-by-item": "purchases",
  "purchase-by-supplier": "purchases",
  "purchase-summary": "purchases",
  "receivable-ageing": "sales",
  "salary-payable": "payroll",
  "sales-by-customer": "sales",
  "sales-by-item": "sales",
  "sales-summary": "sales",
  "slow-moving-stock": "inventory",
  "stock-summary": "inventory",
  "supplier-statement": "purchases",
  "transaction-register": "chart_of_accounts",
  "trial-balance": "chart_of_accounts",
};

export default async function ReportsPage() {
  const session = await requireTenantSession();
  const categories = REPORT_CATALOG.map((c) => ({
    ...c,
    reports: c.reports.filter((r) => {
      const needs = REPORT_MODULE[r.href.split("/")[2] ?? ""];
      return !r.built || !needs || can(session, needs, "view");
    }),
  })).filter((c) => c.reports.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
        <p className="mt-0.5 text-sm text-gray-500">Every report reads from the same posted General Ledger — nothing here recalculates on its own.</p>
      </div>
      {categories.length > 0 ? <ReportsLanding categories={categories} /> : <p className="text-sm text-gray-500">None of the reports are included in your role.</p>}
    </div>
  );
}
