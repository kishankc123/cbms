import { requireTenantSession, can } from "@/lib/session";
import { clampToBooksStart, getBooksStart } from "@/lib/ledger/books-start";
import { seriesProfitAndLoss } from "@/lib/ledger/pnl-series";
import { withTotalOf } from "@/lib/ledger/pnl-series-rules";
import { comparativeBalanceSheet } from "@/lib/ledger/balance-compare";
import { loadTrialBalance } from "@/lib/ledger/trial-balance-data";
import { balanced } from "@/lib/ledger/trial-balance-rules";
import { comparativeCashFlow } from "@/lib/ledger/cashflow-compare";
import { comparisonOf, periodLabel, periodOf, periodOptions, quarterMonthLabel, quarterMonths, quarterTitle } from "@/lib/ledger/pnl-compare-rules";
import { loadReportHeader } from "@/lib/report-header";
import { formatDate, todayIso, validateADDate } from "@/lib/calendar";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import { PrintButton } from "@/components/print-button";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { QuarterSelect } from "../profit-and-loss/pnl-controls";
import { BooksStartNote } from "../books-start-note";
import { BalanceTable } from "../balance-sheet/balance-table";
import { CashFlowTable } from "../cash-flow/cash-flow-table";
import { TrialBalanceTable } from "../trial-balance/trial-balance-table";
import { QuarterlyPnlTable } from "./quarterly-pnl-table";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

/** Profit & Loss, Balance Sheet, Trial Balance and Cash Flow for one fiscal quarter, one printed page each, with the same header. */
export default async function QuarterlyPackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const cal = session.calendar;
  const today = todayIso();
  const quarter = periodOf("quarter", cal, asIso(sp.at) ?? today);
  const before = comparisonOf("quarter", cal, quarter, "previous");
  const lastYear = comparisonOf("quarter", cal, quarter, "last_year");
  const months = quarterMonths(quarter);

  const [header, booksStart] = await Promise.all([loadReportHeader(session.tenantId), getBooksStart(session.tenantId)]);
  const clamp = (r: { from: string; to: string }) => clampToBooksStart(r, booksStart.date);
  const [cur, prev] = [clamp(quarter), clamp(before)];
  const [pnl, balance, trial, cash] = await Promise.all([
    seriesProfitAndLoss(session.tenantId, [...months, lastYear]),
    comparativeBalanceSheet(session.tenantId, quarter.to, before.to),
    loadTrialBalance(session.tenantId, quarter),
    comparativeCashFlow(session.tenantId, cur, prev),
  ]);

  const title = quarterTitle(quarter);
  const when = periodLabel("quarter", cal, quarter);
  const asAt = (iso: string) => `As at ${formatDate(iso, cal, "long")}`;
  const tb = trial.totals;
  const options = periodOptions("quarter", cal, today, quarter.from).map((o) => ({ value: o.value, label: `${quarterTitle(periodOf("quarter", cal, o.value))} — ${o.label}` }));
  const check = (ok: boolean, text: string) => <StatusPill tone={ok ? "success" : "critical"}>{ok ? `✓ ${text}` : `⚠ ${text}: does not balance`}</StatusPill>;
  const page = "[&:not(:first-child)]:mt-10 [&:not(:first-child)]:break-before-page print:[&:not(:first-child)]:mt-0";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <PageHeader title="Quarterly pack" description="Profit & Loss, Balance Sheet, Trial Balance and Cash Flow for the quarter, ready to print or save as PDF." className="!mb-0" />
      </div>
      <BooksStartNote date={booksStart.date} calendar={cal} clamped={cur.clamped || prev.clamped} beforeBooks={cur.beforeBooks} />
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3 print:hidden">
        <QuarterSelect at={quarter.from} options={options} />
        <div className="ml-auto">
          <PrintButton />
        </div>
      </div>

      <ReportSheet>
        <section className={page}>
          <ReportHeader {...header} title="Quarterly Profit & Loss" period={`${title}  ·  ${when}`} />
          <QuarterlyPnlTable data={withTotalOf(pnl, 3)} months={months.map(quarterMonthLabel)} quarter={title.split(" · ")[0]} lastYear={`${title.split(" · ")[0]} last year`} range={quarter} />
        </section>

        <section className={page}>
          <ReportHeader {...header} title="Quarterly Balance Sheet" period={`${title}  ·  ${when}`} />
          <BalanceTable data={balance} to={quarter.to} currentLabel={asAt(quarter.to)} previousLabel={asAt(before.to)} />
          <div className="mt-2 print:hidden">{check(balance.difference.cur === 0 && balance.difference.prev === 0, "Assets equal liabilities and equity")}</div>
        </section>

        <section className={page}>
          <ReportHeader {...header} title="Quarterly Trial Balance" period={`${title}  ·  ${formatDate(quarter.from, cal, "long")} – ${formatDate(quarter.to, cal, "long")}`} />
          <TrialBalanceTable data={trial} period from={quarter.from} to={quarter.to} />
          <div className="mt-2 print:hidden">{check(balanced(tb.opening) && balanced(tb.movement) && balanced(tb.closing), "Debits equal credits")}</div>
        </section>

        <section className={page}>
          <ReportHeader {...header} title="Quarterly Cash Flow Statement" period={`${title}  ·  ${when}`} />
          <CashFlowTable data={cash} range={cur} currentLabel={when} previousLabel={periodLabel("quarter", cal, before)} />
          <div className="mt-2 print:hidden">{check(cash.difference.cur === 0 && cash.difference.prev === 0, "Ties to actual cash movement")}</div>
        </section>

        <ReportFooter />
      </ReportSheet>
    </div>
  );
}
