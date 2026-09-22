import Link from "next/link";
import { getAuditOverview } from "./actions";

const ACTION_LABEL: Record<string, string> = {
  period_closed: "Period closed",
  period_reopened: "Period reopened",
  rule_created: "Rule created",
  exception_updated: "Exception updated",
};

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" | "good" }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "bad" && value > 0 ? "text-red-600" : tone === "warn" && value > 0 ? "text-amber-600" : tone === "good" ? "text-green-600" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

// Audit keeps the books honest: exceptions to review, periods that are locked, the rules watching for problems,
// and a trail of who changed what. Compliance is what you owe the tax authority; this is data integrity.
export default async function AuditOverviewPage() {
  const data = await getAuditOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Audit</h1>
        <p className="mt-0.5 text-sm text-gray-500">Exceptions, locked periods, rules and the audit trail — what keeps your records clean.</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Open exceptions" value={data.openExceptionCount} tone="warn" />
        <SummaryCard label="Blocking exceptions" value={data.blockingExceptionCount} tone="bad" />
        <SummaryCard label="Locked periods" value={data.lockedPeriodCount} />
        <SummaryCard label="Active rules" value={data.activeRuleCount} tone="good" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { href: "/audit/exceptions", name: "Exception Centre", hint: "Review what the system has found" },
          { href: "/audit/rules", name: "Rules & Policies", hint: "Define what the system should check" },
          { href: "/audit/periods", name: "Period Locking", hint: "Close a period, or reopen one with a reason" },
          { href: "/audit/audit-trail", name: "Audit Trail", hint: "Every change, who made it and when" },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50/60">
            <p className="text-sm font-medium text-gray-900">{c.name}</p>
            <p className="mt-1 text-xs text-gray-500">{c.hint}</p>
          </Link>
        ))}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
          <Link href="/audit/audit-trail" className="text-xs text-[var(--color-primary)] hover:underline">
            Open audit trail
          </Link>
        </div>
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">By</th>
              <th className="px-4 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {data.recentActivity.map((a) => (
              <tr key={a.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{ACTION_LABEL[a.action] ?? a.action}</td>
                <td className="px-4 py-2">{a.userName}</td>
                <td className="px-4 py-2 text-gray-500">{new Date(a.at).toLocaleString()}</td>
              </tr>
            ))}
            {data.recentActivity.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                  No activity yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
