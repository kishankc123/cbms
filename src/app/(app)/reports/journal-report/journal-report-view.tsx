"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportFilter } from "@/components/calendar/report-filter";
import { D } from "@/components/calendar/date-text";
import { useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { EntryPopup } from "@/components/ledger/entry-popup";
import { ReversedToggle } from "@/components/ledger/reversal-ui";
import { visibleEntryPairs } from "@/lib/ledger/ledger-lines";
import type { DateRange } from "@/lib/calendar";
import type { JournalReportEntry } from "@/lib/ledger/reports";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  sale: "Sale",
  purchase: "Purchase",
  expense: "Expense",
  payment: "Payment",
  receipt: "Receipt",
  bank_adjustment: "Bank Adjustment",
  manual: "Manual Journal",
  payroll: "Payroll",
  opening_balance: "Opening Balance",
  inter_transfer: "Inter-Transfer",
  tax_assessment: "Tax Assessment",
  sales_return: "Sales Return",
  purchase_return: "Purchase Return",
  advance_application: "Advance Application",
  stock_adjustment: "Stock Adjustment",
  asset_purchase: "Asset Purchase",
  asset_depreciation: "Asset Depreciation",
  asset_disposal: "Asset Disposal",
  asset_writeoff: "Asset Write-Off",
};
const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABEL);

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function JournalReportView({
  entries: allEntries,
  truncated,
  from,
  to,
  fiscal,
  sourceType,
  search,
}: {
  entries: JournalReportEntry[];
  truncated: boolean;
  from: string;
  to: string;
  fiscal: DateRange | null;
  sourceType: string;
  search: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  // Reversed (voided or edited) entries, with the entries that reversed them, are hidden unless asked for.
  const [showReversed, setShowReversed] = useState(false);
  const shownPairs = useMemo(() => visibleEntryPairs(allEntries, showReversed), [allEntries, showReversed]);
  const entries = shownPairs.entries;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("from", from);
    next.set("to", to);
    router.push(`${pathname}?${next.toString()}`);
  }

  function exportCsv() {
    const header = ["Date", "Reference", "Description", "Account", "Debit", "Credit", "Source", "Created By", "Status"];
    const rows: string[][] = [];
    for (const e of entries) {
      const status = e.isReversed ? "Reversed" : e.reversalOfId ? "Reversal" : "Posted";
      for (const l of e.lines) {
        rows.push([
          e.entryDate,
          e.referenceNumber ?? "",
          l.description ?? e.memo ?? "",
          `${l.code} — ${l.name}`,
          l.debit ? fmt(l.debit) : "",
          l.credit ? fmt(l.credit) : "",
          SOURCE_TYPE_LABEL[e.sourceType] ?? e.sourceType,
          e.createdBy,
          status,
        ]);
      }
    }
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-report-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <ReportFilter from={from} to={to} fiscal={fiscal}>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Transaction type</label>
          <select value={sourceType} onChange={(e) => setParam("type", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-40">
            <option value="">All types</option>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input
            defaultValue={search}
            onKeyDown={(e) => e.key === "Enter" && setParam("q", e.currentTarget.value)}
            onBlur={(e) => setParam("q", e.currentTarget.value)}
            placeholder="Reference or description…"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
      </ReportFilter>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          <D value={from} /> – <D value={to} />
          {truncated && <span className="ml-2 text-amber-600">· showing the most recent 500 entries — narrow the date range to see everything</span>}
        </p>
        <div className="flex items-center gap-4">
          <ReversedToggle checked={showReversed} onChange={setShowReversed} hiddenPairs={shownPairs.hiddenPairs} />
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
            <th className="px-4 py-2 font-medium">Account</th>
            <th className="px-4 py-2 font-medium text-right">Debit</th>
            <th className="px-4 py-2 font-medium text-right">Credit</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Created By</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const status = e.isReversed ? "Reversed" : e.reversalOfId ? "Reversal" : "Posted";
            return e.lines.map((l, i) => (
              <tr key={`${e.id}-${i}`} tabIndex={0} role="button" title="Click to see this transaction" onClick={() => setOpenEntry(e.id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpenEntry(e.id); } }} className={`cursor-pointer border-t border-gray-100 hover:bg-[var(--surface-muted-bg)] focus:bg-[var(--surface-muted-bg)] focus:outline-none ${e.isReversed ? "opacity-60" : ""}`}>
                {i === 0 ? (
                  <>
                    <td className="px-4 py-2 whitespace-nowrap" rowSpan={e.lines.length}>
                      <D value={e.entryDate} />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs" rowSpan={e.lines.length}>{e.referenceNumber ?? ""}</td>
                  </>
                ) : null}
                <td className="px-4 py-2">{l.description ?? (i === 0 ? e.memo : "") ?? ""}</td>
                <td className="px-4 py-2">{l.code} — {l.name}</td>
                <td className="px-4 py-2 text-right">{l.debit ? fmt(l.debit) : ""}</td>
                <td className="px-4 py-2 text-right">{l.credit ? fmt(l.credit) : ""}</td>
                {i === 0 ? (
                  <>
                    <td className="px-4 py-2 whitespace-nowrap" rowSpan={e.lines.length}>{SOURCE_TYPE_LABEL[e.sourceType] ?? e.sourceType}</td>
                    <td className="px-4 py-2 whitespace-nowrap" rowSpan={e.lines.length}>{e.createdBy}</td>
                    <td className="px-4 py-2" rowSpan={e.lines.length}>
                      <StatusPill tone={status === "Posted" ? "success" : status === "Reversed" ? "critical" : "pending"}>{status}</StatusPill>
                    </td>
                  </>
                ) : null}
              </tr>
            ));
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-6 text-center text-gray-400">
                No journal entries in this period
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {openEntry && <EntryPopup entryId={openEntry} scope="ledger" onClose={() => setOpenEntry(null)} />}
    </div>
  );
}
