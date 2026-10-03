import { requireTenantSession, can } from "@/lib/session";
import { NextStepNotice } from "../next-step-notice";

export default async function AssetTransactionsPage() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  return <NextStepNotice title="Purchase / Sell asset" description="Record an asset purchase, or sell, dispose of or write off an asset." />;
}
