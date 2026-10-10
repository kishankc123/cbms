import { requirePlatformAdmin } from "@/lib/session";
import { AdminHeader } from "../../ui";
import { getTaxRateAdminData } from "./actions";
import { TaxRatesAdmin } from "./tax-rates-admin";

export default async function AdminTaxRatesPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  await requirePlatformAdmin();
  const { country } = await searchParams;
  const data = await getTaxRateAdminData(country);
  return (
    <div className="space-y-5">
      <AdminHeader
        title="Tax rates"
        description="The VAT and TDS rates every organization in a country uses. A new rate starts on a date you choose and is written into every organization there, so they are all on the same rate from the same day. Past dates keep the rate that applied then."
      />
      <TaxRatesAdmin data={data} />
    </div>
  );
}
