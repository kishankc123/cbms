"use client";

import { useEffect, useState } from "react";
import { getVatWorksheetView } from "./vat-worksheet-actions";
import type { VatWorksheet as Worksheet } from "@/lib/compliance/vat-worksheet";
import { PeriodLabel } from "@/components/calendar/date-text";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function VatWorksheet() {
  const [sheet, setSheet] = useState<Worksheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Start date of the fiscal year being viewed; null = the current year (the server picks it).
  const [yearKey, setYearKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVatWorksheetView(yearKey)
      .then((r) => {
        if (cancelled) return;
        setError(null);
        setSheet(r);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the worksheet"));
    return () => {
      cancelled = true;
    };
  }, [yearKey]);

  if (error) return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-red-600">{error}</div>;
  if (!sheet) return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Loading the worksheet…</div>;
  if (sheet.years.length === 0) {
    return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Nothing to show yet — the worksheet fills in as VAT periods are generated.</div>;
  }

  const rows = sheet.rows;
  const closingCredit = rows.length ? rows[rows.length - 1].creditClosing : sheet.openingCredit;

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">VAT Worksheet</h3>
          <p className="text-xs text-gray-500">
            One fiscal year at a time. Only a VAT receivable (credit) is carried forward and netted off against the next period&apos;s VAT payable. Unpaid VAT payable is never carried — it stays with its period and accrues interest, fines &amp; penalties, calculated from the filing/payment date against the statutory due date.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Fiscal year
          <select value={sheet.selectedKey ?? ""} onChange={(e) => setYearKey(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm">
            {sheet.years.map((y) => (
              <option key={y.key} value={y.key}>
                {y.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Opening balance — VAT receivable brought forward</p>
          <p className="text-lg font-semibold text-gray-900">{fmt(sheet.openingCredit)}</p>
          <p className="text-[11px] text-gray-400">Closing receivable of the previous fiscal year</p>
        </div>
        <div className="rounded border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Closing balance — VAT receivable carried forward</p>
          <p className="text-lg font-semibold text-gray-900">{fmt(closingCredit)}</p>
          <p className="text-[11px] text-gray-400">Becomes the opening balance of the next fiscal year</p>
        </div>
        <div className="rounded border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Unpaid from earlier years (not carried)</p>
          <p className={`text-lg font-semibold ${sheet.earlierUnpaid > 0 ? "text-red-600" : "text-gray-900"}`}>{fmt(sheet.earlierUnpaid)}</p>
          <p className="text-[11px] text-gray-400">VAT and fines still owing from their own periods</p>
        </div>
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
              <th className="py-2 pr-3 text-right">Receivable b/f</th>
              <th className="py-2 pr-3 text-right">Netted off</th>
              <th className="py-2 pr-3 text-right">Receivable c/f</th>
              <th className="py-2 pr-3 text-right">VAT payable</th>
              <th className="py-2 pr-3 text-right">Paid</th>
              <th className="py-2 pr-3 text-right">Pending VAT</th>
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
                <td className={`py-2 pr-3 text-right font-medium ${r.netPay < 0 ? "text-gray-500" : "text-gray-900"}`}>
                  {fmt(Math.abs(r.netPay))}
                  {r.netPay < 0 ? " CR" : ""}
                </td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.creditOpening)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.creditUsed)}</td>
                <td className="py-2 pr-3 text-right font-medium text-gray-900">{fmt(r.creditClosing)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netPayable)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.paid)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.pendingVat)}</td>
                <td className="py-2 pr-3 text-right text-gray-700" title={r.penaltyNote ?? undefined}>
                  {r.finesAndPenalties > 0 ? fmt(r.finesAndPenalties) : "—"}
                  {r.penaltyNote === "Minimum floor rate applied" && <span className="ml-1 text-[10px] text-amber-600">(floor)</span>}
                </td>
                <td className="py-2 pl-3 text-right font-semibold text-gray-900">{fmt(r.totalPayable)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-300 text-sm font-semibold text-gray-900">
              <td className="py-2 pr-3">Total for the year</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.grossSales)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.salesVat)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netPurchase)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.purchaseVat)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netPay)))}</td>
              <td className="py-2 pr-3"></td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.creditUsed)))}</td>
              <td className="py-2 pr-3"></td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netPayable)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.paid)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.pendingVat)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.finesAndPenalties)))}</td>
              <td className="py-2 pl-3 text-right">{fmt(sum(rows.map((r) => r.totalPayable)))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
