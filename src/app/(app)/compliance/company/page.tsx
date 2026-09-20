import { getCompanyDetails } from "../company-actions";
import { CompanyForm } from "./company-form";

export default async function CompanyDetailsPage() {
  const data = await getCompanyDetails();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Company Details</h1>
        <p className="mt-0.5 text-sm text-gray-500">The basics of your business. Your country and company type decide which compliance requirements apply.</p>
      </div>
      <CompanyForm data={data} />
    </div>
  );
}
