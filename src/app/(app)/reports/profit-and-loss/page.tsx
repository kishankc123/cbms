import { requireTenantSession, can } from "@/lib/session";
import { comparativeProfitAndLoss } from "@/lib/ledger/pnl-compare";
import { asCompare, asKind, comparisonOf, periodLabel, periodOf, periodOptions, reportTitle, KIND_LABEL } from "@/lib/ledger/pnl-compare-rules";
import { loadReportHeader } from "@/lib/report-header";
import { formatDate, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { ReportFilter } from "@/components/calendar/report-filter";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import { ExportButtons } from "@/components/export-buttons";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { ComparativeTable } from "./comparative-table";
import { ComparePicker, ViewSelect } from "./pnl-controls";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function ProfitAndLossPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const comparative = sp.view === "comparative";
  const header = await loadReportHeader(session.tenantId);

  const top = (
    <div className="flex items-center gap-3">
      <BackButton href="/reports" label="Back to Reports" />
      <PageHeader title="Profit &amp; Loss" className="!mb-0" />
    </div>
  );

  if (comparative) {
    const kind = asKind(sp.kind);
    const compare = asCompare(sp.compare);
    const today = todayIso();
    const current = periodOf(kind, session.calendar, asIso(sp.at) ?? today);
    const previous = comparisonOf(kind, session.calendar, current, compare);
    const data = await comparativeProfitAndLoss(session.tenantId, current, previous);
    return (
      <div className="space-y-4">
        {top}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3 print:hidden">
          <ViewSelect view="comparative" />
          <ComparePicker kind={kind} at={current.from} compare={compare} options={periodOptions(kind, session.calendar, today, current.from)} />
          <div className="ml-auto">
            <ExportButtons />
          </div>
        </div>
        <ReportSheet>
          <ReportHeader {...header} title={reportTitle(kind)} period={`${KIND_LABEL[kind]}: ${periodLabel(kind, session.calendar, current)}`} />
          <ComparativeTable data={data} range={current} currentLabel={periodLabel(kind, session.calendar, current)} previousLabel={periodLabel(kind, session.calendar, previous)} />
          <ReportFooter />
        </ReportSheet>
      </div>
    );
  }

  const [fiscal, activeFiscalYear] = await Promise.all([getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const data = await comparativeProfitAndLoss(session.tenantId, { from, to });

  return (
    <div className="space-y-4">
      {top}
      <div className="print:hidden">
        <ReportFilter from={from} to={to} fiscal={fiscal}>
          <ViewSelect view="standard" />
        </ReportFilter>
      </div>
      <div className="flex justify-end print:hidden">
        <ExportButtons />
      </div>

      <ReportSheet>
        <ReportHeader {...header} title="Profit & Loss" period={`${formatDate(from, session.calendar, "long")} – ${formatDate(to, session.calendar, "long")}`} />
        <ComparativeTable data={data} range={{ from, to }} currentLabel="Amount" />
        <ReportFooter />
      </ReportSheet>
    </div>
  );
}
