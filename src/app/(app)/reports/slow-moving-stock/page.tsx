import { requireTenantSession, can } from "@/lib/session";
import { slowMovingStock } from "@/lib/inventory/slow-moving";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getReportDefaultAsOf } from "@/lib/fiscal";
import { SlowMovingStockView } from "./slow-moving-stock-view";
import { BackButton } from "@/components/ui/back-button";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const THRESHOLDS = [30, 60, 90, 180];

export default async function SlowMovingStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const asOf = asIso(sp.to) ?? (await getReportDefaultAsOf(session.tenantId));
  const days = typeof sp.days === "string" ? Number(sp.days) : NaN;
  const thresholdDays = THRESHOLDS.includes(days) ? days : 90;

  const rows = await slowMovingStock(session.tenantId, new Date(asOf + "T00:00:00Z"), thresholdDays);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Slow/Non-moving Stock</h1>
      </div>
      <SlowMovingStockView rows={rows} asOf={asOf} thresholdDays={thresholdDays} fiscal={fiscal} />
    </div>
  );
}
