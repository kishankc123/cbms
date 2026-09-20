import { listTaxRegistrations } from "../registration-actions";
import { RegistrationsTable } from "./registrations-table";

export default async function TaxRegistrationsPage() {
  const data = await listTaxRegistrations();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Tax Registrations</h1>
        <p className="mt-0.5 text-sm text-gray-500">The taxes your business is registered for. What you register for decides which returns and payments appear in Tax Compliance.</p>
      </div>
      <RegistrationsTable data={data} />
    </div>
  );
}
