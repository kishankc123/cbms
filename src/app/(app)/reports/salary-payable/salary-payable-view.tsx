"use client";

import type { SalaryPayableRow } from "@/lib/payroll/salary-payable";
import { AccountLink } from "../account-link";

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function SalaryPayableView({ rows, asOf }: { rows: SalaryPayableRow[]; asOf: string }) {
  function exportCsv() {
    const header = ["Employee", "Balance"];
    const dataRows = rows.map((r) => [r.employeeName, fmt(r.balance)]);
    const csv = [header, ...dataRows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `salary-payable-${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = rows.reduce((s, r) => s + r.balance, 0);

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
            <th className="px-4 py-2 font-medium">Employee</th>
            <th className="px-4 py-2 font-medium text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className="border-t border-gray-100">
              <td className="px-4 py-2">
                {r.accountId ? (
                  <AccountLink accountId={r.accountId} to={asOf}>
                    {r.employeeName}
                  </AccountLink>
                ) : (
                  r.employeeName
                )}
              </td>
              <td className="px-4 py-2 text-right">{fmt(r.balance)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className="px-4 py-6 text-center text-gray-400">
                No salary payable as of this date
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{fmt(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
