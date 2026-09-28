"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportFilter } from "@/components/calendar/report-filter";
import { D } from "@/components/calendar/date-text";
import type { DateRange } from "@/lib/calendar";
import type { StatementRow } from "@/lib/ledger/party-statement";

type Customer = { id: string; name: string };

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function CustomerStatementView({
  customers,
  customerId,
  from,
  to,
  fiscal,
  statement,
}: {
  customers: Customer[];
  customerId: string | null;
  from: string;
  to: string;
  fiscal: DateRange | null;
  statement: { customerName: string; openingBalance: number; closingBalance: number; rows: StatementRow[] } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function pickCustomer(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("customer", id);
    else next.delete("customer");
    next.set("from", from);
    next.set("to", to);
    router.push(`${pathname}?${next.toString()}`);
  }

  function exportCsv() {
    if (!statement) return;
    const header = ["Date", "Details", "Debit", "Credit", "Balance"];
    const rows = statement.rows.map((r) => [r.date, r.details, r.debit ? fmt(r.debit) : "", r.credit ? fmt(r.credit) : "", fmt(r.balance)]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-statement-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <ReportFilter from={from} to={to} fiscal={fiscal}>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Customer</label>
          <select value={customerId ?? ""} onChange={(e) => pickCustomer(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-56">
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </ReportFilter>

      {!statement && <p className="text-sm text-gray-500">Choose a customer to see their statement.</p>}

      {statement && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">
              {statement.customerName} <span className="text-sm text-gray-500"><D value={from} /> – <D value={to} /></span>
            </h2>
            <button type="button" onClick={exportCsv} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5">
              Export CSV
            </button>
          </div>
          <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Details</th>
                <th className="px-4 py-2 font-medium text-right">Debit</th>
                <th className="px-4 py-2 font-medium text-right">Credit</th>
                <th className="px-4 py-2 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100 bg-gray-50/50">
                <td className="px-4 py-2 text-gray-500" colSpan={4}>Opening balance</td>
                <td className="px-4 py-2 text-right">{fmt(statement.openingBalance)}</td>
              </tr>
              {statement.rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <D value={r.date} />
                  </td>
                  <td className="px-4 py-2">{r.details}</td>
                  <td className="px-4 py-2 text-right">{r.debit ? fmt(r.debit) : ""}</td>
                  <td className="px-4 py-2 text-right">{r.credit ? fmt(r.credit) : ""}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.balance)}</td>
                </tr>
              ))}
              {statement.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                    No transactions in this period
                  </td>
                </tr>
              )}
              <tr className="border-t-2 border-gray-300 font-medium">
                <td className="px-4 py-2" colSpan={4}>Closing balance</td>
                <td className="px-4 py-2 text-right">{fmt(statement.closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
