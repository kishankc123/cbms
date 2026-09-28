"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportFilter } from "@/components/calendar/report-filter";
import { D } from "@/components/calendar/date-text";
import { StatusPill } from "@/components/ui/status-pill";
import { resolveSourceLink } from "@/lib/ledger/source-link";
import type { DateRange } from "@/lib/calendar";
import type { TransactionRegisterEntry } from "@/lib/ledger/reports";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  sale: "Sale",
  purchase: "Purchase",
  expense: "Expense",
  payment: "Payment",
  receipt: "Receipt",
  bank_adjustment: "Bank Adjustment",
  manual: "Manual Journal",
  payroll: "Payroll",
  opening_balance: "Opening Balance",
  inter_transfer: "Inter-Transfer",
  tax_assessment: "Tax Assessment",
  sales_return: "Sales Return",
  purchase_return: "Purchase Return",
  advance_application: "Advance Application",
  stock_adjustment: "Stock Adjustment",
};
const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABEL);

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function TransactionRegisterView({
  entries,
  truncated,
  from,
  to,
  fiscal,
  sourceType,
  search,
}: {
  entries: TransactionRegisterEntry[];
  truncated: boolean;
  from: string;
  to: string;
  fiscal: DateRange | null;
  sourceType: string;
  search: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("from", from);
    next.set("to", to);
    router.push(`${pathname}?${next.toString()}`);
  }

  function exportCsv() {
    const header = ["Date", "Type", "Reference", "Description", "Amount", "Created By", "Status"];
    const rows = entries.map((e) => {
      const status = e.isReversed ? "Reversed" : e.reversalOfId ? "Reversal" : "Posted";
      return [
        e.entryDate,
        SOURCE_TYPE_LABEL[e.sourceType] ?? e.sourceType,
        e.referenceNumber ?? "",
        e.memo ?? "",
        fmt(e.amount),
        e.createdBy,
        status,
      ];
    });
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `transaction-register-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100;

  return (
    <div className="space-y-4">
      <ReportFilter from={from} to={to} fiscal={fiscal}>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Transaction type</label>
          <select value={sourceType} onChange={(e) => setParam("type", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-40">
            <option value="">All types</option>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input
            defaultValue={search}
            onKeyDown={(e) => e.key === "Enter" && setParam("q", e.currentTarget.value)}
            onBlur={(e) => setParam("q", e.currentTarget.value)}
            placeholder="Reference or description…"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
      </ReportFilter>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          <D value={from} /> – <D value={to} /> · {entries.length} transaction{entries.length === 1 ? "" : "s"}
          {truncated && <span className="ml-2 text-amber-600">· showing the most recent 1000 — narrow the date range to see everything</span>}
        </p>
        <button type="button" onClick={exportCsv} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5">
          Export CSV
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Reference</th>
            <th className="px-4 py-2 font-medium">Description</th>
            <th className="px-4 py-2 font-medium text-right">Amount</th>
            <th className="px-4 py-2 font-medium">Created By</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const status = e.isReversed ? "Reversed" : e.reversalOfId ? "Reversal" : "Posted";
            const source = resolveSourceLink(e.sourceType);
            return (
              <tr key={e.id} className={`border-t border-gray-100 ${e.isReversed ? "opacity-60" : ""}`}>
                <td className="px-4 py-2 whitespace-nowrap">
                  <D value={e.entryDate} />
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{SOURCE_TYPE_LABEL[e.sourceType] ?? e.sourceType}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.referenceNumber ?? ""}</td>
                <td className="px-4 py-2">{e.memo ?? ""}</td>
                <td className="px-4 py-2 text-right">{fmt(e.amount)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{e.createdBy}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={status === "Posted" ? "success" : status === "Reversed" ? "critical" : "pending"}>{status}</StatusPill>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {source ? (
                    <Link href={source.href} className="text-xs text-[var(--color-primary)] hover:underline">
                      {source.label}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                No transactions in this period
              </td>
            </tr>
          )}
        </tbody>
        {entries.length > 0 && (
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50 font-medium">
              <td className="px-4 py-2" colSpan={4}>
                Total
              </td>
              <td className="px-4 py-2 text-right">{fmt(total)}</td>
              <td className="px-4 py-2" colSpan={3}></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
