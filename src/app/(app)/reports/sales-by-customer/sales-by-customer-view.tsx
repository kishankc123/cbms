"use client";

import type { SalesByCustomerRow } from "@/lib/ledger/sales-by-customer";
import { AccountLink } from "../account-link";

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function SalesByCustomerView({ rows, from, to }: { rows: SalesByCustomerRow[]; from: string; to: string }) {
  function exportCsv() {
    const header = ["Customer", "Invoices", "Total Invoiced", "Returns", "Return Amount", "Net Sales"];
    const dataRows = rows.map((r) => [r.customerName, String(r.invoiceCount), fmt(r.totalInvoiced), String(r.returnCount), fmt(r.returnAmount), fmt(r.netSales)]);
    const csv = [header, ...dataRows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-by-customer-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = rows.reduce(
    (acc, r) => ({
      invoiceCount: acc.invoiceCount + r.invoiceCount,
      totalInvoiced: acc.totalInvoiced + r.totalInvoiced,
      returnCount: acc.returnCount + r.returnCount,
      returnAmount: acc.returnAmount + r.returnAmount,
      netSales: acc.netSales + r.netSales,
    }),
    { invoiceCount: 0, totalInvoiced: 0, returnCount: 0, returnAmount: 0, netSales: 0 }
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
            <th className="px-4 py-2 font-medium">Customer</th>
            <th className="px-4 py-2 font-medium text-right">Invoices</th>
            <th className="px-4 py-2 font-medium text-right">Total Invoiced</th>
            <th className="px-4 py-2 font-medium text-right">Returns</th>
            <th className="px-4 py-2 font-medium text-right">Return Amount</th>
            <th className="px-4 py-2 font-medium text-right">Net Sales</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customerId} className="border-t border-gray-100">
              <td className="px-4 py-2">
                {r.accountId ? (
                  <AccountLink accountId={r.accountId} from={from} to={to}>
                    {r.customerName}
                  </AccountLink>
                ) : (
                  r.customerName
                )}
              </td>
              <td className="px-4 py-2 text-right">{r.invoiceCount}</td>
              <td className="px-4 py-2 text-right">{fmt(r.totalInvoiced)}</td>
              <td className="px-4 py-2 text-right">{r.returnCount || ""}</td>
              <td className="px-4 py-2 text-right">{r.returnAmount ? fmt(r.returnAmount) : ""}</td>
              <td className="px-4 py-2 text-right font-medium">{fmt(r.netSales)}</td>
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
              <td className="px-4 py-2 text-right">{totals.invoiceCount}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.totalInvoiced)}</td>
              <td className="px-4 py-2 text-right">{totals.returnCount}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.returnAmount)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.netSales)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
