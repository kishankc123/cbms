"use client";

import type { SalesByItemRow } from "@/lib/ledger/sales-by-item";

const fmt = (n: number) => n.toFixed(2);
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function SalesByItemView({ rows, from, to }: { rows: SalesByItemRow[]; from: string; to: string }) {
  function exportCsv() {
    const header = ["Item", "Qty Sold", "Revenue", "Qty Returned", "Return Amount", "Net Revenue"];
    const dataRows = rows.map((r) => [r.name, fmtQty(r.quantitySold), fmt(r.revenue), fmtQty(r.quantityReturned), fmt(r.returnAmount), fmt(r.netRevenue)]);
    const csv = [header, ...dataRows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-by-item-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = rows.reduce(
    (acc, r) => ({
      quantitySold: acc.quantitySold + r.quantitySold,
      revenue: acc.revenue + r.revenue,
      quantityReturned: acc.quantityReturned + r.quantityReturned,
      returnAmount: acc.returnAmount + r.returnAmount,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { quantitySold: 0, revenue: 0, quantityReturned: 0, returnAmount: 0, netRevenue: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button type="button" onClick={exportCsv} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5">
          Export CSV
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 font-medium text-right">Qty Sold</th>
            <th className="px-4 py-2 font-medium text-right">Revenue</th>
            <th className="px-4 py-2 font-medium text-right">Qty Returned</th>
            <th className="px-4 py-2 font-medium text-right">Return Amount</th>
            <th className="px-4 py-2 font-medium text-right">Net Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-100">
              <td className="px-4 py-2">{r.name}</td>
              <td className="px-4 py-2 text-right">{fmtQty(r.quantitySold)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.revenue)}</td>
              <td className="px-4 py-2 text-right">{r.quantityReturned ? fmtQty(r.quantityReturned) : ""}</td>
              <td className="px-4 py-2 text-right">{r.returnAmount ? fmt(r.returnAmount) : ""}</td>
              <td className="px-4 py-2 text-right font-medium">{fmt(r.netRevenue)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No sales in this period
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{fmtQty(totals.quantitySold)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.revenue)}</td>
              <td className="px-4 py-2 text-right">{fmtQty(totals.quantityReturned)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.returnAmount)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.netRevenue)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
