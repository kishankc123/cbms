"use client";

import { useState } from "react";
import type { TdsWorking } from "@/lib/payroll/salary-tax-calc";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** How one month's salary TDS was worked out: the projection for the year, the slabs, what was already withheld, and the split over the months left. */
export function TdsWorkingTable({ w }: { w: TdsWorking }) {
  if (w.missing) return <p className="text-sm text-gray-600">Salary-tax slabs are not set for this fiscal year, so no TDS was taken. Ask the platform administrator to publish them, then recalculate the run.</p>;
  const row = (label: string, value: string, muted = false, bold = false) => (
    <tr className="border-t border-gray-100">
      <td className={`py-1.5 pr-4 ${muted ? "text-gray-500" : "text-gray-800"} ${bold ? "font-medium" : ""}`}>{label}</td>
      <td className={`py-1.5 text-right tabular-nums ${muted ? "text-gray-500" : "text-gray-800"} ${bold ? "font-medium" : ""}`}>{value}</td>
    </tr>
  );
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        {w.taxpayerClass === "couple" ? "Couple" : "Single"} slabs{w.classAssumed ? " (no tax status chosen, Single used)" : ""} · {w.slabVersion?.label}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {row("Taxable pay this month", money(w.taxablePay))}
          {row("Taxable pay in the earlier months of this fiscal year", money(w.earnedBefore))}
          {w.priorIncome > 0 && row("Income from the earlier employer this year", money(w.priorIncome))}
          {row(`This month and the ${w.monthsLeft - 1} month${w.monthsLeft === 2 ? "" : "s"} still to come at the same pay`, money(w.taxablePay * w.monthsLeft))}
          {row("Projected income for the fiscal year", money(w.projected), false, true)}
          {w.breakdown
            .filter((b) => b.amount > 0)
            .map((b, i) => row(`${b.to === null ? `Above ${money(b.from)}` : `${money(b.from)} to ${money(b.to)}`}: ${money(b.amount)} at ${b.rate}%`, money(b.tax), true))}
          {row("Tax for the year", money(w.annualTax))}
          {row("Already withheld (earlier months" + (w.priorTds > 0 ? " and the earlier employer" : "") + ")", `−${money(w.withheldBefore + w.priorTds)}`)}
          {row(`Still to withhold, split over ${w.monthsLeft} month${w.monthsLeft === 1 ? "" : "s"}`, money(w.stillToWithhold))}
          {row("TDS this month", money(w.tds), false, true)}
        </tbody>
      </table>
    </div>
  );
}

/** The TDS amount of a payroll line, with an ⓘ that opens its working. */
export function TdsCell({ amount, working, title }: { amount: number; working: TdsWorking | null; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="tabular-nums">{amount.toFixed(2)}</span>
      {working && (
        <button type="button" onClick={() => setOpen(true)} aria-label={`How the TDS for ${title} was worked out`} className="ml-1.5 text-gray-400 hover:text-gray-700">
          ⓘ
        </button>
      )}
      {open && working && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg space-y-3 rounded-lg bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">How the TDS was worked out · {title}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            <TdsWorkingTable w={working} />
          </div>
        </div>
      )}
    </>
  );
}
