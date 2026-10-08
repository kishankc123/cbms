import { guardView } from "@/components/page-guard";
import { listStatutory } from "../statutory-actions";
import { StatutoryTable } from "./statutory-table";
import { ComplianceProfileNotice } from "../profile-notice";

export default async function StatutoryCompliancePage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const data = await listStatutory();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Statutory Compliance</h1>
        <p className="mt-0.5 text-sm text-gray-500">Company registry filings, share register and other requirements that are not tax. Tax returns and payments are under Tax Compliance.</p>
      </div>
      <ComplianceProfileNotice />
      <StatutoryTable data={data} />
    </div>
  );
}
