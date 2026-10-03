import { requireTenantSession, can } from "@/lib/session";
import { NextStepNotice } from "../next-step-notice";

export default async function DepreciationPage() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  return <NextStepNotice title="Depreciation" description="Run monthly depreciation and review each asset's schedule." />;
}
