"use client";

import { useEffect, useState } from "react";
import { getVatWorksheetView } from "./vat-worksheet-actions";
import type { VatWorksheetRow } from "@/lib/compliance/vat-worksheet";
import { PeriodLabel } from "@/components/calendar/date-text";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function VatWorksheet() {
  const [rows, setRows] = useState<VatWorksheetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVatWorksheetView()
      .then((r) => !cancelled && setRows(r.rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the worksheet"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-red-600">{error}</div>;
  if (!rows) return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Loading the worksheet…</div>;
  if (rows.length === 0) {
    return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Nothing to show yet — the worksheet fills in as VAT periods are generated.</div>;
  }

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">VAT Payable Worksheet</h3>
        <p className="text-xs text-gray-500">Opening carries the previous period&apos;s closing balance — a credit is never claimed, it simply adjusts the next period. Fines &amp; penalties are calculated automatically from the filing/payment date against the statutory due date.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
              <th className="py-2 pr-3">Period</th>
              <th className="py-2 pr-3 text-right">Gross sales</th>
              <th className="py-2 pr-3 text-right">VAT</th>
              <th className="py-2 pr-3 text-right">Net purchase</th>
              <th className="py-2 pr-3 text-right">VAT</th>
              <th className="py-2 pr-3 text-right">NET Pay</th>
              <th className="py-2 pr-3 text-right">Opening</th>
              <th className="py-2 pr-3 text-right">Paid</th>
              <th className="py-2 pr-3 text-right">Closing</th>
              <th className="py-2 pr-3 text-right">Fines &amp; penalties</th>
              <th className="py-2 pl-3 text-right">Total payable</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.obligationId} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-3 text-gray-900">
                  <PeriodLabel start={r.periodStart} end={r.periodEnd} fallback={r.periodLabel} />
                </td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.grossSales)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.salesVat)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netPurchase)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.purchaseVat)}</td>
                <td className={`py-2 pr-3 text-right font-medium ${r.netPay < 0 ? "text-gray-500" : "text-gray-900"}`}>{fmt(r.netPay)}{r.netPay < 0 ? " CR" : ""}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.opening)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.paid)}</td>
                <td className={`py-2 pr-3 text-right font-medium ${r.closing < 0 ? "text-gray-500" : "text-gray-900"}`}>{fmt(r.closing)}{r.closing < 0 ? " CR" : ""}</td>
                <td className="py-2 pr-3 text-right text-gray-700" title={r.penaltyNote ?? undefined}>
                  {r.finesAndPenalties > 0 ? fmt(r.finesAndPenalties) : "—"}
                  {r.penaltyNote === "Minimum floor rate applied" && <span className="ml-1 text-[10px] text-amber-600">(floor)</span>}
                </td>
                <td className="py-2 pl-3 text-right font-semibold text-gray-900">{fmt(r.totalPayable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
