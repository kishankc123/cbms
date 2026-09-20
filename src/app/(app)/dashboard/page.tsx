import { requireTenantSession } from "@/lib/session";
import { profitAndLoss, trialBalance } from "@/lib/ledger/reports";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formatAD, formatBS, presetRange, todayIso } from "@/lib/calendar";

export default async function DashboardPage() {
  const session = await requireTenantSession();
  const today = todayIso();
  // "This month" follows the organization's calendar: a BS month for BS organizations.
  const range = presetRange("this_month", session.calendar, today);
  const now = new Date(today + "T00:00:00Z");
  const monthStart = new Date(range.from + "T00:00:00Z");

  const [[tenant], pnl, tb] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
    profitAndLoss(session.tenantId, monthStart, now),
    trialBalance(session.tenantId, now),
  ]);

  const adDateLabel = formatAD(today, "long");
  const bsDateLabel = formatBS(today, "long");

  const cards = [
    { label: "Revenue (this month)", value: pnl.totalIncome },
    { label: "Expenses (this month)", value: pnl.totalExpenses },
    { label: "Net Profit (this month)", value: pnl.netProfit },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">KPIs</h1>
        <div className="text-right">
          {tenant?.fiscalYearLabel && (
            <p className="text-sm font-medium text-gray-900">FY {tenant.fiscalYearLabel}</p>
          )}
          <p className="text-xs text-gray-500">
            {adDateLabel} ({bsDateLabel} BS)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">{c.label}</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">
              {c.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-500">System health check</p>
        <p className="mt-1 text-sm">
          Trial balance as of today is{" "}
          <span className={tb.isBalanced ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
            {tb.isBalanced ? "balanced" : "NOT balanced"}
          </span>{" "}
          (debits {tb.totalDebit.toFixed(2)} / credits {tb.totalCredit.toFixed(2)}).
        </p>
      </div>
    </div>
  );
}
