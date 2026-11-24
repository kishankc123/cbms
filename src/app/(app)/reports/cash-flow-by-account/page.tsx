import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { clampToBooksStart, getBooksStart } from "@/lib/ledger/books-start";
import { BooksStartNote } from "../books-start-note";
import { cashFlowByAccount } from "@/lib/ledger/cashflow-by-account";
import { loadReportHeader } from "@/lib/report-header";
import { formatDate, validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { ReportFilter } from "@/components/calendar/report-filter";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import { ExportButtons } from "@/components/export-buttons";
import { StatusPill } from "@/components/ui/status-pill";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { CashFlowByAccountTable } from "./cash-flow-by-account-table";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function CashFlowByAccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [header, booksStart, fiscal, activeFiscalYear] = await Promise.all([loadReportHeader(session.tenantId), getBooksStart(session.tenantId), getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  // The books begin on the books start date: a report cannot start before it, and the opening balances are then its opening line.
  const span = clampToBooksStart({ from, to }, booksStart.date);
  from = span.from;
  const showEmpty = sp.empty === "1";
  const data = await cashFlowByAccount(session.tenantId, from, to, { showEmptyAccounts: showEmpty });

  const params = new URLSearchParams({ from, to });
  if (!showEmpty) params.set("empty", "1");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <PageHeader title="Cash Flow by Account" className="!mb-0" />
      </div>
      <BooksStartNote date={booksStart.date} calendar={session.calendar} clamped={span.clamped} beforeBooks={span.beforeBooks} />
      <div className="print:hidden">
        <ReportFilter from={from} to={to} fiscal={fiscal}>
          <Link href={`/reports/cash-flow-by-account?${params.toString()}`} className="inline-flex h-9 items-center rounded-md border border-line px-3 text-[13px] text-ink hover:bg-hover">
            {showEmpty ? "Hide accounts with no activity" : "Show accounts with no activity"}
          </Link>
        </ReportFilter>
      </div>
      <div className="flex justify-end print:hidden">
        <ExportButtons />
      </div>
      <ReportSheet>
        <ReportHeader {...header} title="Cash Flow by Account" period={`${formatDate(from, session.calendar, "long")} – ${formatDate(to, session.calendar, "long")}`} />
        <CashFlowByAccountTable data={data} range={{ from, to }} />
        <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
          <StatusPill tone={data.balanced ? "success" : "critical"}>
            {data.balanced ? "✓ Closing balances match the ledger" : `⚠ Does not match the ledger: ${data.differences.map((d, i) => (d === 0 ? null : `${data.columns[i].name} ${d.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)).filter(Boolean).join(", ")}`}
          </StatusPill>
          {data.hasTransfers && <span className="text-xs text-ink-2">Inter-transfers appear as money out of one account and money in to another, so they cancel in the Total.</span>}
        </div>
        <ReportFooter />
      </ReportSheet>
    </div>
  );
}
