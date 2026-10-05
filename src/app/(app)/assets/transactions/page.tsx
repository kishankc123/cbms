import { getAssetPurchaseFormData, getOpeningAssetsData } from "../actions";
import { TransactionsTabs } from "./transactions-tabs";

export default async function AssetTransactionsPage() {
  const [data, opening] = await Promise.all([getAssetPurchaseFormData(), getOpeningAssetsData()]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Purchase / Sell asset</h1>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Record an asset purchase, bring in opening assets, or sell, dispose of or write off an asset.</p>
      </div>
      <TransactionsTabs data={data} opening={opening} />
    </div>
  );
}
