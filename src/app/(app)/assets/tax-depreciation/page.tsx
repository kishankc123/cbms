import { guardView } from "@/components/page-guard";
import { PageHeader } from "@/components/ui/page-header";
import { getTaxDepreciationSetupData } from "./actions";
import { TaxDepreciationSetup } from "./tax-depreciation-setup";

export default async function TaxDepreciationPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const denied = await guardView("assets");
  if (denied) return denied;
  const { year } = await searchParams;
  const parsed = year && /^\d{4}$/.test(year) ? Number(year) : undefined;
  const data = await getTaxDepreciationSetupData(parsed);
  return (
    <div className="space-y-6">
      <PageHeader title="Tax depreciation" description="Set up how your assets are grouped for income tax, the balances brought forward and the deferred additions. This is separate from the depreciation in your books and never changes them." />
      <TaxDepreciationSetup data={data} />
    </div>
  );
}
