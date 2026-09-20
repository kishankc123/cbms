import { listTaxCompliance } from "../tax-actions";
import { TaxComplianceTable } from "./tax-compliance-table";

export default async function TaxCompliancePage() {
  const data = await listTaxCompliance();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Tax Compliance</h1>
        <p className="mt-0.5 text-sm text-gray-500">Returns and payments owed to the tax authority. Amounts come from your books, and payments recorded here are real payments.</p>
      </div>
      <TaxComplianceTable data={data} />
    </div>
  );
}
