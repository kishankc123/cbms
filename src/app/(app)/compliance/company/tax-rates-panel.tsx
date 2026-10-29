"use client";

import { Fragment, useEffect, useState } from "react";
import { getTaxRatesOverview, listTaxRateHistory, type RateLine } from "../tax-rate-actions";
import { D } from "@/components/calendar/date-text";
import type { TaxRateRow } from "@/lib/compliance/tax-rates";

// Tax rates are set by the platform administrator for the whole country, never by an organization. This screen only shows what applies
// to this organization, by tax and by TDS heading, and what applied before: every document keeps the rate that was in force on its own date.
export function TaxRatesPanel() {
  const [lines, setLines] = useState<RateLine[] | null>(null);
  const [history, setHistory] = useState<{ key: string; rows: TaxRateRow[] } | null>(null);

  useEffect(() => {
    getTaxRatesOverview().then(setLines);
  }, []);

  // The rows of one group (VAT and Income tax have none; TDS has its headings) under a heading line.
  const groups = lines ? [...new Set(lines.map((l) => l.group))] : [];

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-gray-500">Tax rates are set by the platform administrator. Every document is taxed at the rate that was in force on its own date, whenever it is entered.</p>
      <div className="rounded-lg border border-gray-200 bg-white">
        {lines === null ? (
          <p className="p-5 text-sm text-gray-400">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {groups.map((g) => (
                <Fragment key={g ?? "plain"}>
                  {g && (
                    <tr className="border-t border-gray-100 bg-gray-50">
                      <td colSpan={3} className="px-5 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                        {g}
                      </td>
                    </tr>
                  )}
                  {lines
                    .filter((l) => l.group === g)
                    .map((l) => (
                      <Fragment key={l.key}>
                        <tr className="border-t border-gray-100">
                          <td className={`py-2.5 pr-3 text-gray-900 ${g ? "pl-9" : "pl-5"}`}>{l.label}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-gray-900">
                            {l.slabs ? <span className="text-xs font-normal text-gray-500">By income slab</span> : l.rate === null ? <span className="text-xs font-normal text-gray-400">Not set yet</span> : `${l.rate}%`}
                          </td>
                          <td className="py-2.5 pr-5 text-right">
                            {!l.slabs && l.rate !== null && (
                              <button type="button" onClick={() => (history?.key === l.key ? setHistory(null) : listTaxRateHistory(l.key).then((rows) => setHistory({ key: l.key, rows })))} className="text-xs text-gray-500 hover:underline">
                                {history?.key === l.key ? "Hide history" : "View history"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {history?.key === l.key && (
                          <tr>
                            <td colSpan={3} className="px-5 pb-3">
                              <table className="w-full text-xs">
                                <thead className="text-left text-gray-500">
                                  <tr>
                                    <th className="py-1 pr-3 font-medium">Rate</th>
                                    <th className="py-1 pr-3 font-medium">From</th>
                                    <th className="py-1 font-medium">To</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {history.rows.map((r) => (
                                    <tr key={r.id} className="border-t border-gray-100">
                                      <td className="py-1 pr-3">{r.rate}%</td>
                                      <td className="py-1 pr-3">
                                        <D value={r.effectiveFrom} />
                                      </td>
                                      <td className="py-1 text-gray-500">{r.effectiveTo ? <D value={r.effectiveTo} /> : "current"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
