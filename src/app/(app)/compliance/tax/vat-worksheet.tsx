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
            One fiscal year at a time. Only a VAT receivable (credit) is carried forward and netted off against the next period&apos;s VAT payable. Unpaid VAT payable is never carried — it stays with its own period.
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
          <p className="text-xs text-gray-500">Opening balance</p>
          <p className="text-lg font-semibold text-gray-900">{fmt(sheet.openingCredit)}</p>
        </div>
        <div className="rounded border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Closing balance</p>
          <p className="text-lg font-semibold text-gray-900">{fmt(closingCredit)}</p>
        </div>
        <div className="rounded border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Payable VAT</p>
          <p className={`text-lg font-semibold ${sheet.payableVat > 0 ? "text-red-600" : "text-gray-900"}`}>{fmt(sheet.payableVat)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
              <th className="py-2 pr-3">Period</th>
              <th className="py-2 pr-3 text-right">Net sales</th>
              <th className="py-2 pr-3 text-right">VAT on sales</th>
              <th className="py-2 pr-3 text-right">Net purchase</th>
              <th className="py-2 pr-3 text-right">VAT on purchase</th>
              <th className="py-2 pr-3 text-right">Net payable</th>
              <th className="py-2 pr-3 text-right">Opening balance</th>
              <th className="py-2 pr-3 text-right">VAT paid</th>
              <th className="py-2 pl-3 text-right">Closing balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200 bg-[var(--surface-muted-bg)] font-medium text-gray-900">
              <td className="py-2 pr-3">Opening balance b/f</td>
              <td className="py-2 pr-3" colSpan={7}></td>
              <td className="py-2 pl-3 text-right">{fmt(sheet.openingCredit)}</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.obligationId} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-3 text-gray-900">
                  <PeriodLabel start={r.periodStart} end={r.periodEnd} fallback={r.periodLabel} />
                </td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netSales)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.salesVat)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netPurchase)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.purchaseVat)}</td>
                <td className={`py-2 pr-3 text-right font-medium ${r.netPay < 0 ? "text-gray-500" : "text-gray-900"}`}>
                  {fmt(Math.abs(r.netPay))}
                  {r.netPay < 0 ? " CR" : ""}
                </td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.creditOpening)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.paid)}</td>
                <td className="py-2 pl-3 text-right font-semibold text-gray-900">{fmt(r.creditClosing)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-300 text-sm font-semibold text-gray-900">
              <td className="py-2 pr-3">Total for the year</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netSales)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.salesVat)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netPurchase)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.purchaseVat)))}</td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netPay)))}</td>
              <td className="py-2 pr-3"></td>
              <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.paid)))}</td>
              <td className="py-2 pl-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
