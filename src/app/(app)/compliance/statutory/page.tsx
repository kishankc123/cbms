import { guardView } from "@/components/page-guard";
import { listStatutory } from "../statutory-actions";
import { StatutoryTable } from "./statutory-table";
import { ComplianceProfileNotice } from "../profile-notice";
import { PageHeader } from "@/components/ui/page-header";

export default async function StatutoryCompliancePage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const data = await listStatutory();
  return (
    <div className="space-y-6">
      <PageHeader title="Statutory Compliance" description="Company registry filings, share register and other requirements that are not tax. Tax returns and payments are under Tax Compliance." />
      <ComplianceProfileNotice />
      <StatutoryTable data={data} />
    </div>
  );
}
