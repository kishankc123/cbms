import { requireTenantSession, can } from "@/lib/session";
import { getInventoryValuation } from "@/lib/inventory/valuation";
import { StatusPill } from "@/components/ui/status-pill";
import { BackButton } from "@/components/ui/back-button";

const fmt = (n: number) => n.toFixed(2);
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));

export default async function StockSummaryPage() {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "view")) throw new Error("Not permitted");
  const { items, stockValue, ledger, difference } = await getInventoryValuation(session.tenantId);
  const active = items.filter((i) => i.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Stock Summary</h1>
      </div>
      <p className="text-sm text-gray-500">{active.length} active tracked item{active.length === 1 ? "" : "s"}, as of today</p>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 font-medium text-right">Qty on Hand</th>
            <th className="px-4 py-2 font-medium text-right">Average Cost</th>
            <th className="px-4 py-2 font-medium text-right">Stock Value</th>
          </tr>
        </thead>
        <tbody>
          {active.map((i) => (
            <tr key={i.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{i.name}</td>
              <td className="px-4 py-2 text-right">{fmtQty(i.quantity)}</td>
              <td className="px-4 py-2 text-right">{fmt(i.averageCost)}</td>
              <td className="px-4 py-2 text-right">{fmt(i.value)}</td>
            </tr>
          ))}
          {active.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                No tracked items
              </td>
            </tr>
          )}
        </tbody>
        {active.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2" colSpan={3}>Total Stock Value</td>
              <td className="px-4 py-2 text-right">{fmt(stockValue)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      <div>
        <p className="text-sm text-gray-500 mb-1">Inventory account (1200) balance: {fmt(ledger)}</p>
        <StatusPill tone={difference === 0 ? "success" : "critical"}>
          {difference === 0 ? "✓ Balance Check: Ties to the Inventory account" : `⚠ Difference of ${fmt(difference)} from the Inventory account`}
        </StatusPill>
      </div>
    </div>
  );
}
