"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportFilter } from "@/components/calendar/report-filter";
import { D } from "@/components/calendar/date-text";
import type { DateRange } from "@/lib/calendar";
import { EntryPopup } from "@/components/ledger/entry-popup";
import { ReversalTags, ReversedToggle } from "@/components/ledger/reversal-ui";
import { visibleLedgerLines } from "@/lib/ledger/ledger-lines";

type Account = { id: string; code: string; name: string };
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

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function BankBookView({
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
  ledger: { accountLabel: string; openingBalance: number; lines: Line[] } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  // Reversed (voided or edited) entries are hidden unless asked for; the balance is worked out again without them.
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
    const header = ["Date", "Reference", "Description", "Debit", "Credit", "Balance"];
    const rows = (shown?.lines ?? ledger.lines).map((l) => [l.entryDate, l.referenceNumber ?? "", l.description ?? l.memo ?? "", l.debit ? fmt(l.debit) : "", l.credit ? fmt(l.credit) : "", fmt(l.runningBalance)]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bank-book-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalDebit = shown?.lines.reduce((s, l) => s + l.debit, 0) ?? 0;
  const totalCredit = shown?.lines.reduce((s, l) => s + l.credit, 0) ?? 0;

  return (
    <div className="space-y-4">
      <ReportFilter from={from} to={to} fiscal={fiscal}>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Bank account</label>
          <select value={accountId ?? ""} onChange={(e) => pickAccount(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-56">
            <option value="">Select a bank account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
      </ReportFilter>

      {!ledger && <p className="text-sm text-gray-500">Choose a bank account to see its book.</p>}

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
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium text-right">Debit</th>
                <th className="px-4 py-2 font-medium text-right">Credit</th>
                <th className="px-4 py-2 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100 bg-gray-50/50">
                <td className="px-4 py-2 text-gray-500" colSpan={5}>Opening balance</td>
                <td className="px-4 py-2 text-right">{fmt(ledger.openingBalance)}</td>
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
                  <td className="px-4 py-2 whitespace-nowrap">
                    <D value={l.entryDate} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{l.referenceNumber ?? ""}</td>
                  <td className="px-4 py-2">
                    {l.description ?? l.memo ?? ""}
                    <ReversalTags isReversed={l.isReversed} isReversal={Boolean(l.reversalOfId)} />
                  </td>
                  <td className="px-4 py-2 text-right">{l.debit ? fmt(l.debit) : ""}</td>
                  <td className="px-4 py-2 text-right">{l.credit ? fmt(l.credit) : ""}</td>
                  <td className="px-4 py-2 text-right">{fmt(l.runningBalance)}</td>
                </tr>
              ))}
              {(shown?.lines.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    No transactions in this period
                  </td>
                </tr>
              )}
              <tr className="border-t-2 border-gray-300 font-medium">
                <td className="px-4 py-2" colSpan={3}>Totals</td>
                <td className="px-4 py-2 text-right">{fmt(totalDebit)}</td>
                <td className="px-4 py-2 text-right">{fmt(totalCredit)}</td>
                <td className="px-4 py-2 text-right">{fmt(shown?.lines.at(-1)?.runningBalance ?? ledger.openingBalance)}</td>
              </tr>
            </tbody>
          </table>
          {openEntry && <EntryPopup entryId={openEntry} scope="bank" onClose={() => setOpenEntry(null)} />}
        </>
      )}
    </div>
  );
}
