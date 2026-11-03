import { requireTenantSession, can } from "@/lib/session";
import { trialBalance } from "@/lib/ledger/reports";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getReportDefaultAsOf } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { StatusPill } from "@/components/ui/status-pill";
import { AccountLink } from "../account-link";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const to = asIso(sp.to) ?? (await getReportDefaultAsOf(session.tenantId));
  const tb = await trialBalance(session.tenantId, new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <PageHeader title="Trial Balance" className="!mb-0" />
      </div>
      <ReportFilter from={to} to={to} fiscal={fiscal} asOfOnly />

      <div>
        <p className="mb-2 text-sm text-gray-500">
          As of <D value={to} />
        </p>
        <table className="border-collapse text-[13px] w-full">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Account</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Debit</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-2.5 py-1.5">
                  <AccountLink accountId={r.accountId} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-2.5 py-1.5 text-right">{r.debit ? r.debit.toFixed(2) : ""}</td>
                <td className="px-2.5 py-1.5 text-right">{r.credit ? r.credit.toFixed(2) : ""}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 font-medium">
              <td className="px-2.5 py-1.5">Total</td>
              <td className="px-2.5 py-1.5 text-right">{tb.totalDebit.toFixed(2)}</td>
              <td className="px-2.5 py-1.5 text-right">{tb.totalCredit.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-2">
          <StatusPill tone={tb.isBalanced ? "success" : "critical"}>{tb.isBalanced ? "✓ Balanced" : "⚠ Not balanced — investigate before trusting other reports"}</StatusPill>
        </div>
      </div>
    </div>
  );
}
