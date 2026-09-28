import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { slowMovingStock } from "@/lib/inventory/slow-moving";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { SlowMovingStockView } from "./slow-moving-stock-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const THRESHOLDS = [30, 60, 90, 180];

export default async function SlowMovingStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const asOf = asIso(sp.to) ?? presetRange("this_month", session.calendar, todayIso(), fiscal).to;
  const days = typeof sp.days === "string" ? Number(sp.days) : NaN;
  const thresholdDays = THRESHOLDS.includes(days) ? days : 90;

  const rows = await slowMovingStock(session.tenantId, new Date(asOf + "T00:00:00Z"), thresholdDays);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Slow/Non-moving Stock</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <SlowMovingStockView rows={rows} asOf={asOf} thresholdDays={thresholdDays} fiscal={fiscal} />
    </div>
  );
}
