"use client";

import { useEffect, useMemo, useState } from "react";
import { getCustomerHistory, type LedgerRow } from "../actions";
import { DateRangeControl, type DateFilter } from "../date-range-control";

import { todayIso } from "@/lib/calendar";
import { D } from "@/components/calendar/date-text";
import { DateCells, DateDisplayControl, DateHead, dateColumnCount, useDateDisplay } from "@/components/calendar/report-dates";
export function HistoryPanel({
  customerId,
  fiscalYearStartDate,
}: {
  customerId: string;
  fiscalYearStartDate: string | null;
}) {
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: "all", from: "", to: "" });
  const [mode, setMode] = useDateDisplay();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ openingBalance: number; closingBalance: number; rows: LedgerRow[] } | null>(
    null
  );

  const today = useMemo(() => todayIso(), []);
  const effectiveFrom = dateFilter.mode === "range" ? dateFilter.from : fiscalYearStartDate ?? "";
  const effectiveTo = dateFilter.mode === "range" ? dateFilter.to : today;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCustomerHistory(customerId, effectiveFrom || undefined, effectiveTo || undefined)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, effectiveFrom, effectiveTo]);

  const fmt = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const drCr = (n: number) => (n < 0 ? "Cr" : "Dr");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          From: <span className="font-medium text-gray-700">{effectiveFrom ? <D value={effectiveFrom} /> : "—"}</span> &nbsp; To:{" "}
          <span className="font-medium text-gray-700">{effectiveTo ? <D value={effectiveTo} /> : "—"}</span>
        </p>
        <div className="flex items-end gap-3">
          <DateDisplayControl value={mode} onChange={setMode} />
          <DateRangeControl value={dateFilter} onChange={setDateFilter} />
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && data && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <DateHead mode={mode} />
              <th className="px-4 py-2 font-medium">Details</th>
              <th className="px-4 py-2 font-medium">Debit</th>
              <th className="px-4 py-2 font-medium">Credit</th>
              <th className="px-4 py-2 font-medium">Balance</th>
              <th className="px-4 py-2 font-medium">Dr/Cr</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100 bg-gray-50/50">
              <DateCells mode={mode} value={effectiveFrom} className="px-4 py-2 text-gray-500" />
              <td className="px-4 py-2 text-gray-500">Opening balance</td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2 font-medium">{fmt(data.openingBalance)}</td>
              <td className="px-4 py-2">{drCr(data.openingBalance)}</td>
            </tr>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <DateCells mode={mode} value={r.date} />
                <td className="px-4 py-2">{r.details}</td>
                <td className="px-4 py-2">{r.debit > 0 ? fmt(r.debit) : ""}</td>
                <td className="px-4 py-2">{r.credit > 0 ? fmt(r.credit) : ""}</td>
                <td className="px-4 py-2 font-medium">{fmt(r.balance)}</td>
                <td className="px-4 py-2">{drCr(r.balance)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={5 + dateColumnCount(mode)} className="px-4 py-6 text-center text-gray-400">
                  No transactions in this period
                </td>
              </tr>
            )}
            <tr className="border-t-2 border-gray-300 font-bold">
              <DateCells mode={mode} value={effectiveTo} />
              <td className="px-4 py-2">Closing balance on {effectiveTo ? <D value={effectiveTo} /> : "—"}</td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2">{fmt(data.closingBalance)}</td>
              <td className="px-4 py-2">{drCr(data.closingBalance)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
