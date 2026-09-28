import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { journalReport } from "@/lib/ledger/reports";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { JournalReportView } from "./journal-report-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const asStr = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function JournalReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const dflt = presetRange("this_month", session.calendar, todayIso(), fiscal);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  const sourceType = asStr(sp.type);
  const search = asStr(sp.q);

  const { entries, truncated } = await journalReport(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"), {
    sourceType: sourceType || undefined,
    search: search || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Journal Report</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <JournalReportView entries={entries} truncated={truncated} from={from} to={to} fiscal={fiscal} sourceType={sourceType} search={search} />
    </div>
  );
}
