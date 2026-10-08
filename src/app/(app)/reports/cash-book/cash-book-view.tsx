"use client";

import { useMemo, useState } from "react";
import { ReportFilter } from "@/components/calendar/report-filter";
import { D } from "@/components/calendar/date-text";
import { EntryPopup } from "@/components/ledger/entry-popup";
import { ReversalTags, ReversedToggle } from "@/components/ledger/reversal-ui";
import { visibleLedgerLines } from "@/lib/ledger/ledger-lines";
import type { DateRange } from "@/lib/calendar";
import type { CashBookLine } from "@/lib/ledger/reports";

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function CashBookView({
  accountLabels,
  openingBalance,
  lines,
  from,
  to,
  fiscal,
}: {
  accountLabels: string[];
  openingBalance: number;
  lines: CashBookLine[];
  from: string;
  to: string;
  fiscal: DateRange | null;
}) {
  const showAccountColumn = accountLabels.length > 1;
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  // Reversed (voided or edited) entries are hidden unless asked for; the balance is worked out again without them.
  const [showReversed, setShowReversed] = useState(false);
  const shown = useMemo(() => visibleLedgerLines(lines, openingBalance, showReversed), [lines, openingBalance, showReversed]);
  const totalDebit = shown.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = shown.lines.reduce((s, l) => s + l.credit, 0);

  function exportCsv() {
    const header = ["Date", "Reference", "Description", ...(showAccountColumn ? ["Account"] : []), "Debit", "Credit", "Balance"];
    const rows = shown.lines.map((l) => [
      l.entryDate,
      l.referenceNumber ?? "",
      l.description ?? l.memo ?? "",
      ...(showAccountColumn ? [`${l.accountCode} — ${l.accountName}`] : []),
      l.debit ? fmt(l.debit) : "",
      l.credit ? fmt(l.credit) : "",
      fmt(l.runningBalance),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cash-book-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <ReportFilter from={from} to={to} fiscal={fiscal} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {accountLabels.join(", ") || "No cash account found"} · <D value={from} /> – <D value={to} />
        </p>
        <div className="flex items-center gap-4">
          <ReversedToggle checked={showReversed} onChange={setShowReversed} hiddenPairs={shown.hiddenPairs} />
          <button type="button" onClick={exportCsv} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5">
            Export CSV
          </button>
        </div>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Reference</th>
            <th className="px-4 py-2 font-medium">Description</th>
            {showAccountColumn && <th className="px-4 py-2 font-medium">Account</th>}
            <th className="px-4 py-2 font-medium text-right">Debit</th>
            <th className="px-4 py-2 font-medium text-right">Credit</th>
            <th className="px-4 py-2 font-medium text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-gray-100 bg-gray-50/50">
            <td className="px-4 py-2 text-gray-500" colSpan={showAccountColumn ? 6 : 5}>Opening balance</td>
            <td className="px-4 py-2 text-right">{fmt(openingBalance)}</td>
          </tr>
          {shown.lines.map((l, i) => (
            <tr
              key={i}
              tabIndex={0}
              role="button"
              title="Click to see this transaction"
              onClick={() => setOpenEntry(l.entryId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenEntry(l.entryId);
                }
              }}
              className={`cursor-pointer border-t border-gray-100 hover:bg-[var(--surface-muted-bg)] focus:bg-[var(--surface-muted-bg)] focus:outline-none ${l.isReversed || l.reversalOfId ? "text-gray-400" : ""}`}
            >
              <td className="px-4 py-2 whitespace-nowrap">
                <D value={l.entryDate} />
              </td>
              <td className="px-4 py-2 font-mono text-xs">{l.referenceNumber ?? ""}</td>
              <td className="px-4 py-2">
                {l.description ?? l.memo ?? ""}
                <ReversalTags isReversed={l.isReversed} isReversal={Boolean(l.reversalOfId)} />
              </td>
              {showAccountColumn && <td className="px-4 py-2 whitespace-nowrap">{l.accountCode} — {l.accountName}</td>}
              <td className="px-4 py-2 text-right">{l.debit ? fmt(l.debit) : ""}</td>
              <td className="px-4 py-2 text-right">{l.credit ? fmt(l.credit) : ""}</td>
              <td className="px-4 py-2 text-right">{fmt(l.runningBalance)}</td>
            </tr>
          ))}
          {shown.lines.length === 0 && (
            <tr>
              <td colSpan={showAccountColumn ? 7 : 6} className="px-4 py-6 text-center text-gray-400">
                No cash transactions in this period
              </td>
            </tr>
          )}
          <tr className="border-t-2 border-gray-300 font-medium">
            <td className="px-4 py-2" colSpan={showAccountColumn ? 4 : 3}>Totals</td>
            <td className="px-4 py-2 text-right">{fmt(totalDebit)}</td>
            <td className="px-4 py-2 text-right">{fmt(totalCredit)}</td>
            <td className="px-4 py-2 text-right">{fmt(shown.lines.at(-1)?.runningBalance ?? openingBalance)}</td>
          </tr>
        </tbody>
      </table>
      {openEntry && <EntryPopup entryId={openEntry} scope="bank" onClose={() => setOpenEntry(null)} />}
    </div>
  );
}
