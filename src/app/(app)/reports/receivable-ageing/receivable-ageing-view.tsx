"use client";

import type { ReceivableAgeingRow } from "@/lib/ledger/receivable-ageing";
import { AccountLink } from "../account-link";

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function ReceivableAgeingView({
  rows,
  totals,
  asOf,
}: {
  rows: ReceivableAgeingRow[];
  totals: Omit<ReceivableAgeingRow, "customerId" | "accountId" | "name">;
  asOf: string;
}) {
  function exportCsv() {
    const header = ["Customer", "Current", "1-30 days", "31-60 days", "61-90 days", "90+ days", "Not linked to an invoice", "Total"];
    const dataRows = rows.map((r) => [r.name, fmt(r.current), fmt(r.d1to30), fmt(r.d31to60), fmt(r.d61to90), fmt(r.d90plus), fmt(r.unapplied), fmt(r.total)]);
    const csv = [header, ...dataRows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `receivable-ageing-${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
            <th className="px-4 py-2 font-medium text-right">Current</th>
            <th className="px-4 py-2 font-medium text-right">1–30 days</th>
            <th className="px-4 py-2 font-medium text-right">31–60 days</th>
            <th className="px-4 py-2 font-medium text-right">61–90 days</th>
            <th className="px-4 py-2 font-medium text-right">90+ days</th>
            <th className="px-4 py-2 font-medium text-right">Not linked to an invoice</th>
            <th className="px-4 py-2 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customerId} className="border-t border-gray-100">
              <td className="px-4 py-2">
                {r.accountId ? (
                  <AccountLink accountId={r.accountId} to={asOf}>
                    {r.name}
                  </AccountLink>
                ) : (
                  r.name
                )}
              </td>
              <td className="px-4 py-2 text-right">{r.current ? fmt(r.current) : ""}</td>
              <td className="px-4 py-2 text-right">{r.d1to30 ? fmt(r.d1to30) : ""}</td>
              <td className="px-4 py-2 text-right">{r.d31to60 ? fmt(r.d31to60) : ""}</td>
              <td className="px-4 py-2 text-right">{r.d61to90 ? fmt(r.d61to90) : ""}</td>
              <td className="px-4 py-2 text-right">{r.d90plus ? fmt(r.d90plus) : ""}</td>
              <td className="px-4 py-2 text-right text-gray-500">{r.unapplied ? fmt(r.unapplied) : ""}</td>
              <td className="px-4 py-2 text-right font-medium">{fmt(r.total)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                No outstanding receivables as of this date
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{fmt(totals.current)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.d1to30)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.d31to60)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.d61to90)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.d90plus)}</td>
              <td className="px-4 py-2 text-right text-gray-500">{fmt(totals.unapplied)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
