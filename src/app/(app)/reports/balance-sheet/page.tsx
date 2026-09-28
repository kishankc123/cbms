import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { balanceSheet } from "@/lib/ledger/reports";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { StatusPill } from "@/components/ui/status-pill";
import { AccountLink } from "../account-link";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const to = asIso(sp.to) ?? presetRange("this_month", session.calendar, todayIso(), fiscal).to;
  const bs = await balanceSheet(session.tenantId, new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Balance Sheet</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <ReportFilter from={to} to={to} fiscal={fiscal} asOfOnly />

      <div>
        <p className="mb-2 text-sm text-gray-500">
          As of <D value={to} />
        </p>
        <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <tbody>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Assets</td>
            </tr>
            {bs.assets.map((r) => (
              <tr key={r.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">
                  <AccountLink accountId={r.accountId} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Assets</td>
              <td className="px-4 py-2 text-right">{bs.totalAssets.toFixed(2)}</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Liabilities</td>
            </tr>
            {bs.liabilities.map((r) => (
              <tr key={r.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">
                  <AccountLink accountId={r.accountId} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Liabilities</td>
              <td className="px-4 py-2 text-right">{bs.totalLiabilities.toFixed(2)}</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Equity</td>
            </tr>
            {bs.equity.map((r) => (
              <tr key={r.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">
                  <AccountLink accountId={r.accountId} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Retained Earnings (current)</td>
              <td className="px-4 py-2 text-right">{bs.retainedEarnings.toFixed(2)}</td>
            </tr>
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Equity</td>
              <td className="px-4 py-2 text-right">{bs.totalEquity.toFixed(2)}</td>
            </tr>
            <tr className="border-t-2 border-gray-300 font-semibold">
              <td className="px-4 py-2">Total Liabilities + Equity</td>
              <td className="px-4 py-2 text-right">{(bs.totalLiabilities + bs.totalEquity).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-2">
          <StatusPill tone={bs.isBalanced ? "success" : "critical"}>{bs.isBalanced ? "✓ Balance Check: Balanced" : "⚠ Balance Difference — Assets ≠ Liabilities + Equity"}</StatusPill>
        </div>
      </div>
    </div>
  );
}
