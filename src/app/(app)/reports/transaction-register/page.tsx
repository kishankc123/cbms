import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { transactionRegister } from "@/lib/ledger/reports";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, listFiscalYears, fiscalYearDefaultRange } from "@/lib/fiscal";
import { TransactionRegisterView } from "./transaction-register-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const asStr = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function TransactionRegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const [activeFiscalYear, allFiscalYears] = await Promise.all([getActiveFiscalYear(session.tenantId), listFiscalYears(session.tenantId)]);
  const isAllTime = "allTime" in activeFiscalYear;
  // The sidebar's fiscal-year context sets the default range — pick a fiscal year there and every
  // report that reads it (this one, so far) opens already scoped to it, per the spec's "selecting a
  // fiscal year changes the default reporting context." An explicit ?from=/&to= in the URL still wins.
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  const sourceType = asStr(sp.type);
  const search = asStr(sp.q);

  const { entries, truncated } = await transactionRegister(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"), {
    sourceType: sourceType || undefined,
    search: search || undefined,
  });

  // Matched in memory against the tenant's (short) fiscal-year list — no per-row query.
  const fiscalYearCodeOf = (dateIso: string) => allFiscalYears.find((fy) => fy.startDate <= dateIso && dateIso <= fy.endDate)?.code ?? null;
  const entriesWithFy = entries.map((e) => ({ ...e, fiscalYearCode: fiscalYearCodeOf(e.entryDate) }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Transaction Register</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <TransactionRegisterView entries={entriesWithFy} truncated={truncated} from={from} to={to} fiscal={fiscal} sourceType={sourceType} search={search} showFiscalYearColumn={isAllTime} />
    </div>
  );
}
