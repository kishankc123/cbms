import { guardView } from "@/components/page-guard";
import { getAssetSetupData } from "./actions";
import { SetupTabs } from "./setup-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default async function AssetSetupPage() {
  const denied = await guardView("assets");
  if (denied) return denied;
  const data = await getAssetSetupData();
  return (
    <div className="space-y-6">
      <PageHeader title="Assets setup" description="Asset numbering, the accounts assets post to, categories and locations." />
      <SetupTabs data={data} />
    </div>
  );
}
