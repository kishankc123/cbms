import { guardView } from "@/components/page-guard";
import { listTaxCompliance } from "../tax-actions";
import { TaxComplianceTabs } from "./tax-compliance-tabs";
import { ExcisePermitAlert } from "../excise-permit-alert";
import { ComplianceProfileNotice } from "../profile-notice";

export default async function TaxCompliancePage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const data = await listTaxCompliance();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Tax Compliance</h1>
        <p className="mt-0.5 text-sm text-gray-500">Returns and payments owed to the tax authority. Amounts come from your books, and payments recorded here are real payments.</p>
      </div>
      <ComplianceProfileNotice />
      <ExcisePermitAlert />
      <TaxComplianceTabs data={data} />
    </div>
  );
}
