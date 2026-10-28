"use client";

import { useMemo, useState } from "react";
import { D } from "@/components/calendar/date-text";
import { StatusPill } from "@/components/ui/status-pill";
import { useProblem } from "@/components/problem-dialog";
import { confirmMatch, type StatementLineRow, type UnmatchedLedgerRow } from "./actions";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayGap = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

/**
 * For one bank line that has no confirmed match: pick the book entries it belongs to (one deposit can cover several invoices),
 * and see at once whether they add up to the bank amount. Only entries already posted to this bank's own ledger account are
 * offered, the closest in amount and date first. Or record a new transaction instead.
 */
export function FindMatchPanel({
  bankAccountId,
  line,
  ledger,
  locked,
  onClose,
  onMatched,
  onCreate,
}: {
  bankAccountId: string;
  line: StatementLineRow;
  ledger: UnmatchedLedgerRow[];
  locked: boolean;
  onClose: () => void;
  onMatched: () => void;
  onCreate: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const { report, dialog } = useProblem();

  // Closest first: an entry for the same amount near the same date is the likely one.
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledger
      .filter((l) => !q || `${l.memo ?? ""} ${l.description ?? ""} ${l.referenceNumber ?? ""} ${l.signedAmount}`.toLowerCase().includes(q))
      .sort((a, b) => Math.abs(a.signedAmount - line.amount) - Math.abs(b.signedAmount - line.amount) || dayGap(a.entryDate, line.transactionDate) - dayGap(b.entryDate, line.transactionDate));
  }, [ledger, line, search]);

  const total = round2(ledger.filter((l) => picked.has(l.journalLineId)).reduce((s, l) => s + l.signedAmount, 0));
  const gap = round2(line.amount - total);
  const matching = picked.size > 0 && Math.abs(gap) < 0.005;

  async function match() {
    setBusy(true);
    try {
      await confirmMatch({ bankAccountId, statementLineIds: [line.id], journalLineIds: [...picked], matchType: "manual" });
      onMatched();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "This couldn't be matched. Check that the entries add up to the bank amount.", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Find a match</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              <D value={line.transactionDate} /> · {line.description || "—"} ·{" "}
              <span className={line.amount >= 0 ? "text-green-700" : "text-red-600"}>{fmt(line.amount)}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="Close">
            ✕
          </button>
        </div>

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your books by description, reference or amount" className="rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--text-primary)]" />

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-[var(--card-border)]">
          {sorted.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--text-secondary)]">{ledger.length === 0 ? "Everything in your books for this account is already matched." : "Nothing matches that search."}</p>
          ) : (
            <ul className="divide-y divide-[var(--card-border)]">
              {sorted.map((l) => (
                <li key={l.journalLineId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--surface-muted-bg)]">
                    <input
                      type="checkbox"
                      checked={picked.has(l.journalLineId)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(l.journalLineId)) next.delete(l.journalLineId);
                          else next.add(l.journalLineId);
                          return next;
                        })
                      }
                    />
                    <span className="w-24 shrink-0 text-[var(--text-secondary)]">
                      <D value={l.entryDate} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{l.memo || l.description || l.referenceNumber || "—"}</span>
                    <span className="tabular-nums text-[var(--text-primary)]">{fmt(l.signedAmount)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-[var(--text-secondary)]">
              Selected <span className="tabular-nums text-[var(--text-primary)]">{fmt(total)}</span> of <span className="tabular-nums text-[var(--text-primary)]">{fmt(line.amount)}</span>
            </span>
            {picked.size > 0 && (matching ? <StatusPill tone="success">Matching</StatusPill> : <StatusPill tone="critical">Not matching: {fmt(gap)} to go</StatusPill>)}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCreate} className="text-[var(--color-primary)] hover:underline">
              Nothing here? Create a transaction
            </button>
            <button type="button" disabled={busy || locked || !matching} onClick={match} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40">
              Match
            </button>
          </div>
        </div>
        {locked && <p className="text-xs text-amber-700">This date falls inside a period that is already reconciled. Reopen it to change anything here.</p>}
      </div>
      {dialog}
    </div>
  );
}
