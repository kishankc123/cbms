import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { purchaseBySupplier } from "@/lib/ledger/purchase-by-supplier";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { PurchaseBySupplierView } from "./purchase-by-supplier-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function PurchaseBySupplierPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const dflt = presetRange("this_month", session.calendar, todayIso(), fiscal);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const rows = await purchaseBySupplier(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Purchase by Supplier</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />
      <p className="text-sm text-gray-500">
        <D value={from} /> – <D value={to} />
      </p>
      <PurchaseBySupplierView rows={rows} from={from} to={to} />
    </div>
  );
}
