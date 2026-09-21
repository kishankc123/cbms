import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { itemUnits } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getInventoryValuation } from "@/lib/inventory/valuation";
import { StatusPill } from "@/components/ui/status-pill";
import { StockTabs } from "./stock-tabs";
import { StockMaintenance } from "./maintenance";
import { getInventoryHistory, getOpeningRows } from "@/lib/inventory/opening";
import { getOpeningDate } from "@/lib/inventory/stock";
import { verifyStockBalances } from "@/lib/inventory/recalc";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const session = await requireTenantSession();
  const [valuation, units, openingDate, openingRows, history, mismatched] = await Promise.all([
    getInventoryValuation(session.tenantId),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)),
    getOpeningDate(session.tenantId),
    getOpeningRows(session.tenantId),
    getInventoryHistory(session.tenantId),
    verifyStockBalances(session.tenantId),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const shown = valuation.items.filter((i) => i.isActive || i.quantity !== 0 || i.value !== 0);
  const balanced = Math.abs(valuation.difference) < 0.005;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Stock</h1>
        <p className="text-sm text-gray-500">What is on hand, what it cost, and how it ties to the Inventory account.</p>
      </div>

      <StockTabs
        items={valuation.items.map((i) => ({ id: i.id, name: i.name, unitId: i.unitId, quantity: i.quantity, averageCost: i.averageCost }))}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        openingDate={openingDate}
        openingRows={openingRows}
        history={history}
        initialTab={tab}
        report={
          <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Stock value (all items)</p>
          <p className="text-xl font-semibold text-gray-900">{fmt(valuation.stockValue)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Inventory account (ledger)</p>
          <p className="text-xl font-semibold text-gray-900">{fmt(valuation.ledger)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Difference</p>
          <p className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            {fmt(valuation.difference)}
            <StatusPill tone={balanced ? "success" : "critical"}>{balanced ? "Matches" : "Needs attention"}</StatusPill>
          </p>
          {!balanced && <p className="mt-1 text-xs text-gray-500">Inventory holds value no item accounts for (or the reverse). Post a stock adjustment or correct the entry behind it.</p>}
        </div>
      </div>

      <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 font-medium">Unit</th>
            <th className="px-4 py-2 text-right font-medium">On hand</th>
            <th className="px-4 py-2 text-right font-medium">Average cost</th>
            <th className="px-4 py-2 text-right font-medium">Value</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((i) => (
            <tr key={i.id} className="border-t border-gray-100">
              <td className="px-4 py-2">
                {i.name}
                {!i.isActive && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Inactive</span>}
                {i.quantity < 0 && <span className="ml-2"><StatusPill tone="critical">Negative stock</StatusPill></span>}
                {i.quantity === 0 && i.value !== 0 && <span className="ml-2"><StatusPill tone="pending">Value with no stock</StatusPill></span>}
              </td>
              <td className="px-4 py-2 text-gray-500">{unitName.get(i.unitId ?? "") ?? "—"}</td>
              <td className="px-4 py-2 text-right">{i.quantity}</td>
              <td className="px-4 py-2 text-right">{fmt(i.averageCost)}</td>
              <td className="px-4 py-2 text-right">{fmt(i.value)}</td>
              <td className="px-4 py-2 text-right">
                <Link href={`/inventory/stock/${i.id}`} className="text-xs text-gray-600 hover:underline">
                  Stock card
                </Link>
              </td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No stock yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <StockMaintenance mismatched={mismatched} />
          </div>
        }
      />
    </div>
  );
}
