import { guardView } from "@/components/page-guard";
import { getDepreciationPageData } from "../actions";
import { DepreciationView } from "./depreciation-view";

export default async function DepreciationPage() {
  const denied = await guardView("assets");
  if (denied) return denied;
  const data = await getDepreciationPageData();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Depreciation</h1>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Post a month&apos;s depreciation for every asset in one entry, and review earlier runs.</p>
      </div>
      <DepreciationView data={data} />
    </div>
  );
}
