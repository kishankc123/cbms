import { requireTenantSession, can } from "@/lib/session";
import { clampToBooksStart, getBooksStart } from "@/lib/ledger/books-start";
import { BooksStartNote } from "../books-start-note";
import { comparativeCashFlow } from "@/lib/ledger/cashflow-compare";
import { asCompare, asKind, comparisonOf, periodLabel, periodOf, periodOptions, reportTitle, KIND_LABEL } from "@/lib/ledger/pnl-compare-rules";
import { loadReportHeader } from "@/lib/report-header";
import { formatDate, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { ReportFilter } from "@/components/calendar/report-filter";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import { ExportButtons } from "@/components/export-buttons";
import { StatusPill } from "@/components/ui/status-pill";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { ComparePicker, ViewSelect } from "../profit-and-loss/pnl-controls";
import { CashFlowTable } from "./cash-flow-table";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [header, booksStart] = await Promise.all([loadReportHeader(session.tenantId), getBooksStart(session.tenantId)]);
  // The books begin on the books start date: a report cannot start before it, and the opening balances are then its opening line.
  const clamp = (r: { from: string; to: string }) => clampToBooksStart(r, booksStart.date);
  const check = (diff: number, label?: string) => <StatusPill tone={diff === 0 ? "success" : "critical"}>{diff === 0 ? `✓ Ties to actual cash movement${label ? ` (${label})` : ""}` : `⚠ Difference — does not match actual cash movement${label ? ` (${label})` : ""}`}</StatusPill>;

  const top = (
    <div className="flex items-center gap-3">
      <BackButton href="/reports" label="Back to Reports" />
      <PageHeader title="Cash Flow Statement" className="!mb-0" />
    </div>
  );

  if (sp.view === "comparative") {
    const kind = asKind(sp.kind);
    const compare = asCompare(sp.compare);
    const today = todayIso();
    const chosen = periodOf(kind, session.calendar, asIso(sp.at) ?? today);
    const current = clamp(chosen);
    const previous = clamp(comparisonOf(kind, session.calendar, chosen, compare));
    const data = await comparativeCashFlow(session.tenantId, current, previous);
    return (
      <div className="space-y-4">
        {top}
        <BooksStartNote date={booksStart.date} calendar={session.calendar} clamped={current.clamped || previous.clamped} beforeBooks={current.beforeBooks} />
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3 print:hidden">
          <ViewSelect view="comparative" />
          <ComparePicker kind={kind} at={chosen.from} compare={compare} options={periodOptions(kind, session.calendar, today, chosen.from)} />
          <div className="ml-auto">
            <ExportButtons />
          </div>
        </div>
        <ReportSheet>
          <ReportHeader {...header} title={reportTitle(kind, "Cash Flow Statement")} period={`${KIND_LABEL[kind]}: ${periodLabel(kind, session.calendar, chosen)}`} />
          <CashFlowTable data={data} range={current} currentLabel={periodLabel(kind, session.calendar, chosen)} previousLabel={periodLabel(kind, session.calendar, comparisonOf(kind, session.calendar, chosen, compare))} />
          <div className="mt-2 flex gap-2 print:hidden">
            {check(data.difference.cur, "this period")}
            {check(data.difference.prev, "comparison")}
          </div>
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
  const span = clamp({ from, to });
  from = span.from;
  const data = await comparativeCashFlow(session.tenantId, { from, to });

  return (
    <div className="space-y-4">
      {top}
      <BooksStartNote date={booksStart.date} calendar={session.calendar} clamped={span.clamped} beforeBooks={span.beforeBooks} />
      <div className="print:hidden">
        <ReportFilter from={from} to={to} fiscal={fiscal}>
          <ViewSelect view="standard" />
        </ReportFilter>
      </div>
      <div className="flex justify-end print:hidden">
        <ExportButtons />
      </div>
      <ReportSheet>
        <ReportHeader {...header} title="Cash Flow Statement" period={`${formatDate(from, session.calendar, "long")} – ${formatDate(to, session.calendar, "long")}`} />
        <CashFlowTable data={data} range={{ from, to }} currentLabel="Amount" />
        <div className="mt-2 print:hidden">{check(data.difference.cur)}</div>
        <ReportFooter />
      </ReportSheet>
    </div>
  );
}
