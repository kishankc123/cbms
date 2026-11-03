import { guardView } from "@/components/page-guard";
import { getAssetPurchaseFormData, getDisposalFormData, getOpeningAssetsData } from "../actions";
import { TransactionsTabs } from "./transactions-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default async function AssetTransactionsPage() {
  const denied = await guardView("assets");
  if (denied) return denied;
  const [data, opening, disposal] = await Promise.all([getAssetPurchaseFormData(), getOpeningAssetsData(), getDisposalFormData()]);
  return (
    <div className="space-y-5">
      <PageHeader title="Purchase / Sell asset" description="Record an asset purchase, bring in opening assets, or sell, dispose of or write off an asset." />
      <TransactionsTabs data={data} opening={opening} disposal={disposal} />
    </div>
  );
}
