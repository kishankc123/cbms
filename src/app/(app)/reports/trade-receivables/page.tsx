import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { clampToBooksStart, getBooksStart } from "@/lib/ledger/books-start";
import { BooksStartNote } from "../books-start-note";
import { tradeReceivables } from "@/lib/ledger/party-balances";
import { loadReportHeader } from "@/lib/report-header";
import { formatDate, validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { ReportFilter } from "@/components/calendar/report-filter";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { PartyBalancesView, type PartyConfig } from "../party-balances/party-balances-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

const CONFIG: PartyConfig = {
  parties: "Customers",
  party: "customer",
  labels: { inv: "Credit sales", pay: "Paid", ret: "Returns", other: "Adjustments" },
  statement: { href: "/reports/customer-statement", param: "customer" },
  scope: "sales",
  control: "Accounts Receivable",
};

export default async function TradeReceivablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [header, booksStart, fiscal, activeFiscalYear] = await Promise.all([loadReportHeader(session.tenantId), getBooksStart(session.tenantId), getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  // The books begin on the books start date: a report cannot start before it, and what was entered at the start is then its opening line.
  const span = clampToBooksStart({ from, to }, booksStart.date);
  from = span.from;
  const includeCashSale = sp.cash === "1";
  const data = await tradeReceivables(session.tenantId, from, to, { includeCashSale });
  const params = new URLSearchParams({ from, to });
  if (!includeCashSale) params.set("cash", "1");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <PageHeader title="Trade Receivables" className="!mb-0" />
      </div>
      <BooksStartNote date={booksStart.date} calendar={session.calendar} clamped={span.clamped} beforeBooks={span.beforeBooks} />
      <div className="print:hidden">
        <ReportFilter from={from} to={to} fiscal={fiscal} />
      </div>
      <PartyBalancesView
        config={CONFIG}
        title="Trade Receivables"
        header={{ company: header.company, address: header.address }}
        period={`${formatDate(from, session.calendar, "long")} – ${formatDate(to, session.calendar, "long")}`}
        from={from}
        to={to}
        rows={data.rows}
        totals={data.totals}
        check={data.check}
        leftOut={data.leftOut}
        recon={null}
        extraControls={
          <Link href={`/reports/trade-receivables?${params.toString()}`} className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px] text-ink hover:bg-hover">
            {includeCashSale ? "Leave out Cash Sale" : "Include Cash Sale"}
          </Link>
        }
      />
    </div>
  );
}
