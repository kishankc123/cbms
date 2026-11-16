import { requireTenantSession, can } from "@/lib/session";
import { loadTrialBalance } from "@/lib/ledger/trial-balance-data";
import { balanced } from "@/lib/ledger/trial-balance-rules";
import { asKind, periodLabel, periodOf, periodOptions, KIND_LABEL } from "@/lib/ledger/pnl-compare-rules";
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
import { TrialBalanceTable } from "./trial-balance-table";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const header = await loadReportHeader(session.tenantId);
  const check = (ok: boolean) => <StatusPill tone={ok ? "success" : "critical"}>{ok ? "✓ Balanced" : "⚠ Not balanced — investigate before trusting other reports"}</StatusPill>;

  const top = (
    <div className="flex items-center gap-3">
      <BackButton href="/reports" label="Back to Reports" />
      <PageHeader title="Trial Balance" className="!mb-0" />
    </div>
  );

  if (sp.view === "comparative") {
    const kind = asKind(sp.kind);
    const today = todayIso();
    const current = periodOf(kind, session.calendar, asIso(sp.at) ?? today);
    const data = await loadTrialBalance(session.tenantId, current);
    const t = data.totals;
    const dates = `${formatDate(current.from, session.calendar, "long")} – ${formatDate(current.to, session.calendar, "long")}`;
    return (
      <div className="space-y-4">
        {top}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3 print:hidden">
          <ViewSelect view="comparative" otherLabel="By period" />
          <ComparePicker kind={kind} at={current.from} compare="previous" options={periodOptions(kind, session.calendar, today, current.from)} noCompare />
          <div className="ml-auto">
            <PrintButton />
          </div>
        </div>
        <ReportSheet>
          <ReportHeader {...header} title="Trial Balance" period={`${KIND_LABEL[kind]}: ${periodLabel(kind, session.calendar, current)}  ·  ${dates}`} />
          <TrialBalanceTable data={data} period from={current.from} to={current.to} />
          <div className="mt-2 print:hidden">{check(balanced(t.opening) && balanced(t.movement) && balanced(t.closing))}</div>
          <ReportFooter />
        </ReportSheet>
      </div>
    );
  }

  const fiscal = await getFiscalRange(session.tenantId);
  const to = asIso(sp.to) ?? (await getReportDefaultAsOf(session.tenantId));
  const data = await loadTrialBalance(session.tenantId, { to });
  return (
    <div className="space-y-4">
      {top}
      <div className="print:hidden">
        <ReportFilter from={to} to={to} fiscal={fiscal} asOfOnly>
          <ViewSelect view="standard" otherLabel="By period" />
        </ReportFilter>
      </div>
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <ReportSheet>
        <ReportHeader {...header} title="Trial Balance" period={`As at ${formatDate(to, session.calendar, "long")}`} />
        <TrialBalanceTable data={data} period={false} to={to} />
        <div className="mt-2 print:hidden">{check(balanced(data.totals.closing))}</div>
        <ReportFooter />
      </ReportSheet>
    </div>
  );
}
