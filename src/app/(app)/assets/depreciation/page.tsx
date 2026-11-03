import { guardView } from "@/components/page-guard";
import { getDepreciationPageData } from "../actions";
import { DepreciationView } from "./depreciation-view";
import { PageHeader } from "@/components/ui/page-header";

export default async function DepreciationPage() {
  const denied = await guardView("assets");
  if (denied) return denied;
  const data = await getDepreciationPageData();
  return (
    <div className="space-y-5">
      <PageHeader title="Depreciation" description="Post a month&apos;s depreciation for every asset in one entry, and review earlier runs." />
      <DepreciationView data={data} />
    </div>
  );
}
