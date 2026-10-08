"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { D } from "@/components/calendar/date-text";
import type { EntryDetail } from "@/lib/ledger/entry-detail";
import { getLedgerEntry } from "./actions";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

/** The transaction behind a ledger line: the whole entry, with the line that was clicked picked out. */
export function EntryPopup({ entryId, highlightAccountId, onClose }: { entryId: string; highlightAccountId: string | null; onClose: () => void }) {
  const [entry, setEntry] = useState<EntryDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getLedgerEntry(entryId)
      .then((e) => live && setEntry(e))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load the transaction."));
    return () => {
      live = false;
    };
  }, [entryId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-label="Transaction" className="relative max-h-[88vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{entry ? `${entry.kind}${entry.referenceNumber ? ` ${entry.referenceNumber}` : ""}` : "Transaction"}</h2>
            {entry && (
              <p className="mt-0.5 text-sm text-gray-500">
                <D value={entry.entryDate} />
                {entry.createdBy ? ` · posted by ${entry.createdBy}` : ""}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {entry === undefined && !error && <p className="text-sm text-gray-500">Loading...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {entry === null && <p className="text-sm text-gray-500">This transaction could not be found.</p>}

        {entry && (
          <>
            {(entry.isReversal || entry.isReversed) && (
              <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{entry.isReversal ? "This entry reverses an earlier one (an edit or a void)." : "This entry has been reversed by a later one."}</p>
            )}
            {entry.memo && <p className="text-sm text-gray-700">{entry.memo}</p>}

            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-center font-medium">Debit</th>
                  <th className="px-3 py-2 text-center font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((l, i) => (
                  <tr key={i} className={`border-t border-gray-100 ${l.accountId === highlightAccountId ? "bg-[var(--surface-muted-bg)] font-medium" : ""}`}>
                    <td className="px-3 py-2">
                      {l.code} — {l.name}
                      {l.mode && <span className="ml-2 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-normal text-gray-500">{l.mode}</span>}
                      {l.description && <p className="text-xs font-normal text-gray-500">{l.description}</p>}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{l.debit ? fmt(l.debit) : ""}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{l.credit ? fmt(l.credit) : ""}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 font-medium">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-center tabular-nums">{fmt(entry.totalDebit)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{fmt(entry.totalCredit)}</td>
                </tr>
              </tbody>
            </table>

            <div className="flex items-center justify-between">
              {entry.link ? (
                <Link href={entry.link.href} className="text-sm text-[var(--color-primary)] hover:underline">
                  {entry.link.label}
                </Link>
              ) : (
                <span />
              )}
              <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
