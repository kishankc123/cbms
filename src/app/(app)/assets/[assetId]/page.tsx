import { notFound } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { StatusPill } from "@/components/ui/status-pill";
import { getAssetDetailData } from "../actions";
import { STATUS_LABEL, STATUS_TONE, money } from "../shared";
import { AssetDetail } from "./asset-detail";

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

export default async function AssetDetailPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const data = await getAssetDetailData(assetId);
  if (!data) notFound();
  const a = data.asset;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton href="/assets" label="Back to Asset list" />
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold text-[var(--text-primary)]">
            <span className="font-mono text-xl text-[var(--text-secondary)]">{a.assetCode}</span>
            {a.name}
            <StatusPill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</StatusPill>
          </h1>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
            {a.categoryName}
            {a.locationName ? ` · ${a.locationName}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Cost" value={money(a.capitalizedCost)} />
        <Card label="Accumulated depreciation" value={money(a.accumulatedDepreciation)} />
        <Card label="Net book value" value={money(a.netBookValue)} />
        <Card label="Monthly depreciation" value={money(data.schedule[0]?.depreciation ?? 0)} />
      </div>

      <AssetDetail data={data} />
    </div>
  );
}
