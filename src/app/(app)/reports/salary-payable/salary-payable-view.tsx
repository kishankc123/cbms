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
        <button type="button" onClick={exportCsv} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-surface px-3 py-[5px] text-[13px] font-medium text-ink transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50">
          Export CSV
        </button>
      </div>

      <table className="border-collapse text-[13px] w-full">
        <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Employee</th>
            <th className="px-2.5 py-1.5 font-medium text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className="border-b border-line transition-colors hover:bg-hover">
              <td className="px-2.5 py-1.5">
                {r.accountId ? (
                  <AccountLink accountId={r.accountId} to={asOf}>
                    {r.employeeName}
                  </AccountLink>
                ) : (
                  r.employeeName
                )}
              </td>
              <td className="px-2.5 py-1.5 text-right">{fmt(r.balance)}</td>
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
              <td className="px-2.5 py-1.5">Total</td>
              <td className="px-2.5 py-1.5 text-right">{fmt(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
