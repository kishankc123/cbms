import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { trialBalance } from "@/lib/ledger/reports";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { StatusPill } from "@/components/ui/status-pill";
import { AccountLink } from "../account-link";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const to = asIso(sp.to) ?? presetRange("this_month", session.calendar, todayIso(), fiscal).to;
  const tb = await trialBalance(session.tenantId, new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Trial Balance</h1>
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
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 text-right font-medium">Debit</th>
              <th className="px-4 py-2 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <AccountLink accountId={r.accountId} to={to}>
                    {r.code} — {r.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{r.debit ? r.debit.toFixed(2) : ""}</td>
                <td className="px-4 py-2 text-right">{r.credit ? r.credit.toFixed(2) : ""}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 font-medium">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{tb.totalDebit.toFixed(2)}</td>
              <td className="px-4 py-2 text-right">{tb.totalCredit.toFixed(2)}</td>
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
