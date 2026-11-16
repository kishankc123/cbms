import { requireTenantSession, can } from "@/lib/session";
import { comparativeBalanceSheet } from "@/lib/ledger/balance-compare";
import { asCompare, asKind, comparisonOf, periodOf, periodOptions, reportTitle, KIND_LABEL, periodLabel } from "@/lib/ledger/pnl-compare-rules";
import { loadReportHeader } from "@/lib/report-header";
import { formatDate, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange, getReportDefaultAsOf } from "@/lib/fiscal";
import { ReportFilter } from "@/components/calendar/report-filter";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import { PrintButton } from "@/components/print-button";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ComparePicker, ViewSelect } from "../profit-and-loss/pnl-controls";
import { BalanceTable } from "./balance-table";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const comparative = sp.view === "comparative";
  const header = await loadReportHeader(session.tenantId);
  const asAt = (iso: string) => `As at ${formatDate(iso, session.calendar, "long")}`;
  const check = (diff: number, label?: string) => <StatusPill tone={diff === 0 ? "success" : "critical"}>{diff === 0 ? `✓ Balanced${label ? ` ${label}` : ""}` : `⚠ Assets ≠ Liabilities + Equity${label ? ` ${label}` : ""}`}</StatusPill>;

  const top = (
    <div className="flex items-center gap-3">
      <BackButton href="/reports" label="Back to Reports" />
      <PageHeader title="Balance Sheet" className="!mb-0" />
    </div>
  );

  if (comparative) {
    const kind = asKind(sp.kind);
    const compare = asCompare(sp.compare);
    const today = todayIso();
    const current = periodOf(kind, session.calendar, asIso(sp.at) ?? today);
    const previous = comparisonOf(kind, session.calendar, current, compare);
    const data = await comparativeBalanceSheet(session.tenantId, current.to, previous.to);
    return (
      <div className="space-y-4">
        {top}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3 print:hidden">
          <ViewSelect view="comparative" />
          <ComparePicker kind={kind} at={current.from} compare={compare} options={periodOptions(kind, session.calendar, today, current.from)} />
          <div className="ml-auto">
            <PrintButton />
          </div>
        </div>
        <ReportSheet>
          <ReportHeader {...header} title={reportTitle(kind, "Balance Sheet")} period={`${KIND_LABEL[kind]}: ${periodLabel(kind, session.calendar, current)}  ·  ${asAt(current.to)}`} />
          <BalanceTable data={data} to={current.to} currentLabel={asAt(current.to)} previousLabel={asAt(previous.to)} />
          <div className="mt-2 flex gap-2 print:hidden">
            {check(data.difference.cur, asAt(current.to))}
            {check(data.difference.prev, asAt(previous.to))}
          </div>
          <ReportFooter />
        </ReportSheet>
      </div>
    );
  }

  const fiscal = await getFiscalRange(session.tenantId);
  const to = asIso(sp.to) ?? (await getReportDefaultAsOf(session.tenantId));
  const data = await comparativeBalanceSheet(session.tenantId, to);

  return (
    <div className="space-y-4">
      {top}
      <div className="print:hidden">
        <ReportFilter from={to} to={to} fiscal={fiscal} asOfOnly>
          <ViewSelect view="standard" />
        </ReportFilter>
      </div>
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <ReportSheet>
        <ReportHeader {...header} title="Balance Sheet" period={asAt(to)} />
        <BalanceTable data={data} to={to} currentLabel="Amount" />
        <div className="mt-2 print:hidden">{check(data.difference.cur)}</div>
        <ReportFooter />
      </ReportSheet>
    </div>
  );
}
