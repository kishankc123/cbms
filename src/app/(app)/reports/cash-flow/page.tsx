import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { cashFlowStatement } from "@/lib/ledger/reports";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { StatusPill } from "@/components/ui/status-pill";
import { AccountLink } from "../account-link";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const dflt = presetRange("this_month", session.calendar, todayIso(), fiscal);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const cf = await cashFlowStatement(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Cash Flow Statement</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />

      <div>
        <p className="mb-2 text-sm text-gray-500">
          <D value={from} /> – <D value={to} />
        </p>
        <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <tbody>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Operating Activities</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Net Profit</td>
              <td className="px-4 py-2 text-right">{cf.netProfit.toFixed(2)}</td>
            </tr>
            {cf.operating.map((r) => (
              <tr key={r.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">
                  <AccountLink accountId={r.accountId} from={from} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Net Cash from Operating Activities</td>
              <td className="px-4 py-2 text-right">{cf.netCashFromOperating.toFixed(2)}</td>
            </tr>

            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Investing Activities</td>
            </tr>
            {cf.investing.map((r) => (
              <tr key={r.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">
                  <AccountLink accountId={r.accountId} from={from} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            {cf.investing.length === 0 && (
              <tr className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8 text-gray-400">No investing activity</td>
                <td className="px-4 py-2 text-right"></td>
              </tr>
            )}
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Net Cash from Investing Activities</td>
              <td className="px-4 py-2 text-right">{cf.netCashFromInvesting.toFixed(2)}</td>
            </tr>

            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Financing Activities</td>
            </tr>
            {cf.financing.map((r) => (
              <tr key={r.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">
                  <AccountLink accountId={r.accountId} from={from} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            {cf.financing.length === 0 && (
              <tr className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8 text-gray-400">No financing activity</td>
                <td className="px-4 py-2 text-right"></td>
              </tr>
            )}
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Net Cash from Financing Activities</td>
              <td className="px-4 py-2 text-right">{cf.netCashFromFinancing.toFixed(2)}</td>
            </tr>

            <tr className="border-t-2 border-gray-300 font-semibold">
              <td className="px-4 py-2">Net Change in Cash</td>
              <td className="px-4 py-2 text-right">{cf.netChangeInCash.toFixed(2)}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 text-gray-500">Actual Cash Movement (Cash + Bank accounts)</td>
              <td className="px-4 py-2 text-right text-gray-500">{cf.actualCashMovement.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-2">
          <StatusPill tone={cf.isBalanced ? "success" : "critical"}>
            {cf.isBalanced ? "✓ Balance Check: Ties to actual cash movement" : "⚠ Difference — does not match actual cash movement"}
          </StatusPill>
        </div>
      </div>
    </div>
  );
}
