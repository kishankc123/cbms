import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { receivableAgeing } from "@/lib/ledger/receivable-ageing";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { ReceivableAgeingView } from "./receivable-ageing-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function ReceivableAgeingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const to = asIso(sp.to) ?? presetRange("this_month", session.calendar, todayIso(), fiscal).to;

  const { rows, totals, asOf } = await receivableAgeing(session.tenantId, new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Receivable Ageing</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <ReportFilter from={to} to={to} fiscal={fiscal} asOfOnly />
      <p className="text-sm text-gray-500">
        As of <D value={asOf} />
      </p>
      <ReceivableAgeingView rows={rows} totals={totals} asOf={asOf} />
    </div>
  );
}
