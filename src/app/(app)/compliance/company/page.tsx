import { guardView } from "@/components/page-guard";
import { getCompanyDetails } from "../company-actions";
import { listTaxRegistrations } from "../registration-actions";
import { CompanyTabs } from "./company-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default async function CompanyDetailsPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const [data, registrations] = await Promise.all([getCompanyDetails(), listTaxRegistrations()]);
  return (
    <div className="space-y-6">
      <PageHeader title="Company Details" description="The basics of your business. Your country and company type decide which compliance requirements apply." />
      <CompanyTabs data={data} registrations={registrations} />
    </div>
  );
}
