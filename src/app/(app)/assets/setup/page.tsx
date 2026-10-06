import { guardView } from "@/components/page-guard";
import { getAssetSetupData } from "./actions";
import { SetupTabs } from "./setup-tabs";

export default async function AssetSetupPage() {
  const denied = await guardView("assets");
  if (denied) return denied;
  const data = await getAssetSetupData();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Assets setup</h1>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Asset numbering, the accounts assets post to, categories and locations.</p>
      </div>
      <SetupTabs data={data} />
    </div>
  );
}
