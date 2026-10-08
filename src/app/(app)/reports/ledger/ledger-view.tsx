"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportFilter } from "@/components/calendar/report-filter";
import { DateCells, DateDisplayControl, DateHead, dateColumnCount, useDateDisplay } from "@/components/calendar/report-dates";
import { exportDateColumns, exportDateHeaders, type DateRange } from "@/lib/calendar";
import { D } from "@/components/calendar/date-text";
import { EntryPopup } from "@/components/ledger/entry-popup";
import { ReversalTags, ReversedToggle } from "@/components/ledger/reversal-ui";
import { visibleLedgerLines } from "@/lib/ledger/ledger-lines";

type Account = { id: string; code: string; name: string; subCategory: string | null };
type Line = {
  entryId: string;
  isReversed: boolean;
  reversalOfId: string | null;
  entryDate: string;
  referenceNumber: string | null;
  memo: string | null;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

const isCashOrBank = (a: Account) => /cash|bank/i.test(`${a.subCategory ?? ""} ${a.name}`);
const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function LedgerView({
  accounts,
  accountId,
  from,
  to,
  fiscal,
  ledger,
}: {
  accounts: Account[];
  accountId: string | null;
  from: string;
  to: string;
  fiscal: DateRange | null;
  ledger: { accountId: string; accountLabel: string; openingBalance: number; lines: Line[] } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [mode, setMode] = useDateDisplay();
  // The transaction whose pop-up is open.
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  // Entries that were reversed (a void or an edit), and the entries that reversed them, are hidden unless asked for.
  const [showReversed, setShowReversed] = useState(false);
  const shown = useMemo(() => (ledger ? visibleLedgerLines(ledger.lines, ledger.openingBalance, showReversed) : null), [ledger, showReversed]);

  function pickAccount(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("account", id);
    else next.delete("account");
    next.set("from", from);
    next.set("to", to);
    router.push(`${pathname}?${next.toString()}`);
  }

  function exportCsv() {
    if (!ledger) return;
    const header = [...exportDateHeaders(mode), "Reference", "Description", "Debit", "Credit", "Balance"];
    const opening = [...exportDateColumns(mode, from), "", "Opening balance", "", "", fmt(ledger.openingBalance)];
    const rows = (shown?.lines ?? ledger.lines).map((l) => [
      ...exportDateColumns(mode, l.entryDate),
      l.referenceNumber ?? "",
      l.description ?? l.memo ?? "",
      l.debit ? fmt(l.debit) : "",
      l.credit ? fmt(l.credit) : "",
      fmt(l.runningBalance),
    ]);
    const csv = [header, opening, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cashBank = accounts.filter(isCashOrBank);
  const other = accounts.filter((a) => !isCashOrBank(a));
  const cols = dateColumnCount(mode);
  const totalDebit = shown?.lines.reduce((s, l) => s + l.debit, 0) ?? 0;
  const totalCredit = shown?.lines.reduce((s, l) => s + l.credit, 0) ?? 0;

  return (
    <div className="space-y-4">
      <ReportFilter from={from} to={to} fiscal={fiscal}>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Account</label>
          <select value={accountId ?? ""} onChange={(e) => pickAccount(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-56">
            <option value="">Select an account…</option>
            {cashBank.length > 0 && (
              <optgroup label="Cash & Bank">
                {cashBank.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="All accounts">
              {other.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <DateDisplayControl value={mode} onChange={setMode} />
      </ReportFilter>

      {!ledger && <p className="text-sm text-gray-500">Choose an account to see its ledger (general, bank or cash).</p>}

      {ledger && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">
              {ledger.accountLabel} <span className="text-sm text-gray-500"><D value={from} /> – <D value={to} /></span>
            </h2>
            <div className="flex items-center gap-4">
              <ReversedToggle checked={showReversed} onChange={setShowReversed} hiddenPairs={shown?.hiddenPairs ?? 0} />
              <button type="button" onClick={exportCsv} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5">
                Export CSV
              </button>
            </div>
          </div>
          <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <DateHead mode={mode} />
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium text-center">Debit</th>
                <th className="px-4 py-2 font-medium text-center">Credit</th>
                <th className="px-4 py-2 font-medium text-center">Balance</th>
              </tr>
            </thead>
            <tbody>
              {/* The balance brought in, dated the first day of the period, with its amount in the Balance column. */}
              <tr className="border-t border-gray-100 bg-gray-50/50">
                <DateCells mode={mode} value={from} />
                <td className="px-4 py-2" />
                <td className="px-4 py-2 text-gray-500">Opening balance</td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2" />
                <td className="px-4 py-2 text-center tabular-nums">{fmt(ledger.openingBalance)}</td>
              </tr>
              {(shown?.lines ?? []).map((l, i) => (
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
                  <DateCells mode={mode} value={l.entryDate} />
                  <td className="px-4 py-2 font-mono text-xs">{l.referenceNumber ?? ""}</td>
                  <td className="px-4 py-2">
                    {l.description ?? l.memo ?? ""}
                    <ReversalTags isReversed={l.isReversed} isReversal={Boolean(l.reversalOfId)} />
                  </td>
                  <td className="px-4 py-2 text-center tabular-nums">{l.debit ? fmt(l.debit) : ""}</td>
                  <td className="px-4 py-2 text-center tabular-nums">{l.credit ? fmt(l.credit) : ""}</td>
                  <td className="px-4 py-2 text-center tabular-nums">{fmt(l.runningBalance)}</td>
                </tr>
              ))}
              {(shown?.lines.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={cols + 5} className="px-4 py-6 text-center text-gray-400">
                    No transactions in this period
                  </td>
                </tr>
              )}
              <tr className="border-t-2 border-gray-300 font-medium">
                <td className="px-4 py-2" colSpan={cols + 2}>Totals</td>
                <td className="px-4 py-2 text-center tabular-nums">{fmt(totalDebit)}</td>
                <td className="px-4 py-2 text-center tabular-nums">{fmt(totalCredit)}</td>
                <td className="px-4 py-2 text-center tabular-nums">{fmt(shown?.lines.at(-1)?.runningBalance ?? ledger.openingBalance)}</td>
              </tr>
            </tbody>
          </table>
          {openEntry && <EntryPopup entryId={openEntry} scope="ledger" highlightAccountId={ledger.accountId} onClose={() => setOpenEntry(null)} />}
        </>
      )}
    </div>
  );
}
