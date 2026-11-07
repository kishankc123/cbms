import { guardView } from "@/components/page-guard";
import { listTaxCompliance } from "../tax-actions";
import { TaxComplianceTabs } from "./tax-compliance-tabs";
import { CatchupPrompt } from "../catchup-prompt";
import { ExcisePermitAlert } from "../excise-permit-alert";
import { ComplianceProfileNotice } from "../profile-notice";
import { PageHeader } from "@/components/ui/page-header";

export default async function TaxCompliancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const { tab } = await searchParams;
  const data = await listTaxCompliance();
  return (
    <div className="space-y-6">
      <PageHeader title="Tax Compliance" description="Returns and payments owed to the tax authority. Amounts come from your books, and payments recorded here are real payments." />
      <ComplianceProfileNotice />
      <ExcisePermitAlert />
      <CatchupPrompt />
      <TaxComplianceTabs data={data} initialTab={tab} />
    </div>
  );
}
