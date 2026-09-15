import { requireTenantSession } from "@/lib/session";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/ledger/reports";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default async function ReportsPage() {
  const session = await requireTenantSession();
  const now = new Date();
  const monthStart = startOfMonth(now);

  const [tb, pnl, bs] = await Promise.all([
    trialBalance(session.tenantId, now),
    profitAndLoss(session.tenantId, monthStart, now),
    balanceSheet(session.tenantId, now),
  ]);

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>

      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          Trial Balance <span className="text-sm text-gray-500">as of {now.toLocaleDateString()}</span>
        </h2>
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium text-right">Debit</th>
              <th className="px-4 py-2 font-medium text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.code} className="border-t border-gray-100">
                <td className="px-4 py-2">{r.code} — {r.name}</td>
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
        <p className={`text-sm mt-1 ${tb.isBalanced ? "text-green-600" : "text-red-600"}`}>
          {tb.isBalanced ? "Balanced" : "NOT balanced — investigate before trusting other reports"}
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          Profit &amp; Loss{" "}
          <span className="text-sm text-gray-500">
            {monthStart.toLocaleDateString()} – {now.toLocaleDateString()}
          </span>
        </h2>
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <tbody>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Income</td>
            </tr>
            {pnl.income.map((r) => (
              <tr key={r.code} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">{r.code} — {r.name}</td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Income</td>
              <td className="px-4 py-2 text-right">{pnl.totalIncome.toFixed(2)}</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Expenses</td>
            </tr>
            {pnl.expenses.map((r) => (
              <tr key={r.code} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">{r.code} — {r.name}</td>
                <td className="px-4 py-2 text-right">{r.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Expenses</td>
              <td className="px-4 py-2 text-right">{pnl.totalExpenses.toFixed(2)}</td>
            </tr>
            <tr className="border-t-2 border-gray-300 font-semibold">
              <td className="px-4 py-2">Net Profit</td>
              <td className="px-4 py-2 text-right">{pnl.netProfit.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          Balance Sheet <span className="text-sm text-gray-500">as of {now.toLocaleDateString()}</span>
        </h2>
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <tbody>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Assets</td>
            </tr>
            {bs.assets.map((r) => (
              <tr key={r.code} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">{r.code} — {r.name}</td>
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
              <tr key={r.code} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">{r.code} — {r.name}</td>
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
              <tr key={r.code} className="border-t border-gray-100">
                <td className="px-4 py-2 pl-8">{r.code} — {r.name}</td>
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
              <td className="px-4 py-2 text-right">
                {(bs.totalLiabilities + bs.totalEquity).toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className={`text-sm mt-1 ${bs.isBalanced ? "text-green-600" : "text-red-600"}`}>
          {bs.isBalanced
            ? "Assets = Liabilities + Equity"
            : "NOT balanced — Assets ≠ Liabilities + Equity"}
        </p>
      </section>
    </div>
  );
}
