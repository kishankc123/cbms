import { requireTenantSession } from "@/lib/session";
import { profitAndLoss, trialBalance } from "@/lib/ledger/reports";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default async function DashboardPage() {
  const session = await requireTenantSession();
  const now = new Date();
  const monthStart = startOfMonth(now);

  const [pnl, tb] = await Promise.all([
    profitAndLoss(session.tenantId, monthStart, now),
    trialBalance(session.tenantId, now),
  ]);

  const cards = [
    { label: "Revenue (this month)", value: pnl.totalIncome },
    { label: "Expenses (this month)", value: pnl.totalExpenses },
    { label: "Net Profit (this month)", value: pnl.netProfit },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>

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
