"use client";

import type { PurchaseBySupplierRow } from "@/lib/ledger/purchase-by-supplier";
import { AccountLink } from "../account-link";

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function PurchaseBySupplierView({ rows, from, to }: { rows: PurchaseBySupplierRow[]; from: string; to: string }) {
  function exportCsv() {
    const header = ["Supplier", "Bills", "Total Billed", "Returns", "Return Amount", "Net Purchases"];
    const dataRows = rows.map((r) => [r.vendorName, String(r.billCount), fmt(r.totalBilled), String(r.returnCount), fmt(r.returnAmount), fmt(r.netPurchases)]);
    const csv = [header, ...dataRows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-by-supplier-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = rows.reduce(
    (acc, r) => ({
      billCount: acc.billCount + r.billCount,
      totalBilled: acc.totalBilled + r.totalBilled,
      returnCount: acc.returnCount + r.returnCount,
      returnAmount: acc.returnAmount + r.returnAmount,
      netPurchases: acc.netPurchases + r.netPurchases,
    }),
    { billCount: 0, totalBilled: 0, returnCount: 0, returnAmount: 0, netPurchases: 0 }
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
            <th className="px-4 py-2 font-medium">Supplier</th>
            <th className="px-4 py-2 font-medium text-right">Bills</th>
            <th className="px-4 py-2 font-medium text-right">Total Billed</th>
            <th className="px-4 py-2 font-medium text-right">Returns</th>
            <th className="px-4 py-2 font-medium text-right">Return Amount</th>
            <th className="px-4 py-2 font-medium text-right">Net Purchases</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vendorId} className="border-t border-gray-100">
              <td className="px-4 py-2">
                {r.accountId ? (
                  <AccountLink accountId={r.accountId} from={from} to={to}>
                    {r.vendorName}
                  </AccountLink>
                ) : (
                  r.vendorName
                )}
              </td>
              <td className="px-4 py-2 text-right">{r.billCount}</td>
              <td className="px-4 py-2 text-right">{fmt(r.totalBilled)}</td>
              <td className="px-4 py-2 text-right">{r.returnCount || ""}</td>
              <td className="px-4 py-2 text-right">{r.returnAmount ? fmt(r.returnAmount) : ""}</td>
              <td className="px-4 py-2 text-right font-medium">{fmt(r.netPurchases)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No purchases in this period
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{totals.billCount}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.totalBilled)}</td>
              <td className="px-4 py-2 text-right">{totals.returnCount}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.returnAmount)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.netPurchases)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
