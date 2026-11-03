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
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Statutory Compliance</h1>
        <p className="mt-0.5 text-sm text-gray-500">Company registry filings, share register and other requirements that are not tax. Tax returns and payments are under Tax Compliance.</p>
      </div>
      <ComplianceProfileNotice />
      <StatutoryTable data={data} />
    </div>
  );
}
