"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportFilter } from "@/components/calendar/report-filter";
import { D } from "@/components/calendar/date-text";
import type { DateRange } from "@/lib/calendar";
import type { SlowMovingRow } from "@/lib/inventory/slow-moving";

const THRESHOLDS = [30, 60, 90, 180];
const fmt = (n: number) => n.toFixed(2);
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function SlowMovingStockView({
  rows,
  asOf,
  thresholdDays,
  fiscal,
}: {
  rows: SlowMovingRow[];
  asOf: string;
  thresholdDays: number;
  fiscal: DateRange | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setThreshold(days: string) {
    const next = new URLSearchParams(params.toString());
    next.set("days", days);
    next.set("to", asOf);
    router.push(`${pathname}?${next.toString()}`);
  }

  function exportCsv() {
    const header = ["Item", "Qty on Hand", "Stock Value", "Last Movement", "Days Since Movement"];
    const dataRows = rows.map((r) => [r.name, fmtQty(r.quantity), fmt(r.stockValue), r.lastMovementDate ?? "Never", r.daysSinceMovement === null ? "Never moved" : String(r.daysSinceMovement)]);
    const csv = [header, ...dataRows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `slow-moving-stock-${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalValue = rows.reduce((s, r) => s + r.stockValue, 0);

  return (
    <div className="space-y-4">
      <ReportFilter from={asOf} to={asOf} fiscal={fiscal} asOfOnly>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Stale after</label>
          <select value={thresholdDays} onChange={(e) => setThreshold(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            {THRESHOLDS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
      </ReportFilter>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          As of <D value={asOf} /> · {rows.length} item{rows.length === 1 ? "" : "s"} with no movement in {thresholdDays}+ days
        </p>
        <button type="button" onClick={exportCsv} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5">
          Export CSV
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 font-medium text-right">Qty on Hand</th>
            <th className="px-4 py-2 font-medium text-right">Stock Value</th>
            <th className="px-4 py-2 font-medium">Last Movement</th>
            <th className="px-4 py-2 font-medium text-right">Days Idle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className="border-t border-gray-100">
              <td className="px-4 py-2">{r.name}</td>
              <td className="px-4 py-2 text-right">{fmtQty(r.quantity)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.stockValue)}</td>
              <td className="px-4 py-2 whitespace-nowrap">{r.lastMovementDate ? <D value={r.lastMovementDate} /> : "Never"}</td>
              <td className="px-4 py-2 text-right">{r.daysSinceMovement ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                No slow-moving stock at this threshold
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2" colSpan={2}>Total</td>
              <td className="px-4 py-2 text-right">{fmt(totalValue)}</td>
              <td className="px-4 py-2" colSpan={2}></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
