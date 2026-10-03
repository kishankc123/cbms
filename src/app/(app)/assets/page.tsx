import { requireTenantSession, can } from "@/lib/session";
import { NextStepNotice } from "./next-step-notice";

export default async function AssetListPage() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  return <NextStepNotice title="Asset list" description="Every fixed asset, its cost, accumulated depreciation and net book value." />;
}
