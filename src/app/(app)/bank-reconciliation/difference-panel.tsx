"use client";

import { D } from "@/components/calendar/date-text";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatementLineRow, UnmatchedLedgerRow } from "./actions";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * "Why is there a difference?": the bank balance and the books balance differ only by what is not yet matched. Bank lines that
 * are not in the books are recorded or matched from the list; entries in the books that are not on the statement (a cheque
 * not yet cleared, a deposit in transit) are explained here, which is what lets the period be marked reconciled.
 */
export function DifferencePanel({
  statementBalance,
  ledgerBalance,
  unmatchedBank,
  unmatchedLedger,
  locked,
  onClassify,
  onClose,
}: {
  statementBalance: number;
  ledgerBalance: number;
  unmatchedBank: StatementLineRow[];
  unmatchedLedger: UnmatchedLedgerRow[];
  locked: (date: string) => boolean;
  onClassify: (line: UnmatchedLedgerRow) => void;
  onClose: () => void;
}) {
  const difference = round2(statementBalance - ledgerBalance);
  const bankSum = round2(unmatchedBank.reduce((s, l) => s + l.amount, 0));
  const ledgerSum = round2(unmatchedLedger.reduce((s, l) => s + l.signedAmount, 0));
  const unexplained = round2(difference - (bankSum - ledgerSum));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Why is there a difference?</h2>
          <button type="button" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="Close">
            ✕
          </button>
        </div>

        <p className="text-sm text-[var(--text-primary)]">
          The bank says <span className="font-medium tabular-nums">{fmt(statementBalance)}</span> and your books say <span className="font-medium tabular-nums">{fmt(ledgerBalance)}</span>, a difference of{" "}
          <span className={`font-medium tabular-nums ${Math.abs(difference) < 0.005 ? "text-green-700" : "text-red-600"}`}>{fmt(difference)}</span>. It comes from the two lists below.
        </p>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">On the bank statement, not in your books</h3>
            <span className="text-sm tabular-nums text-[var(--text-secondary)]">{fmt(bankSum)}</span>
          </div>
          {unmatchedBank.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">Nothing. Every bank line is matched.</p>
          ) : (
            <ul className="divide-y divide-[var(--card-border)] rounded border border-[var(--card-border)] text-sm">
              {unmatchedBank.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-24 shrink-0 text-[var(--text-secondary)]">
                    <D value={l.transactionDate} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{l.description || "—"}</span>
                  <span className="tabular-nums text-[var(--text-primary)]">{fmt(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {unmatchedBank.length > 0 && <p className="text-xs text-[var(--text-secondary)]">Match or record each one from the list, using Find or create.</p>}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">In your books, not on the bank statement</h3>
            <span className="text-sm tabular-nums text-[var(--text-secondary)]">{fmt(ledgerSum)}</span>
          </div>
          {unmatchedLedger.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">Nothing. Every entry in your books is matched.</p>
          ) : (
            <ul className="divide-y divide-[var(--card-border)] rounded border border-[var(--card-border)] text-sm">
              {unmatchedLedger.map((l) => (
                <li key={l.journalLineId} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-24 shrink-0 text-[var(--text-secondary)]">
                    <D value={l.entryDate} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{l.memo || l.description || "—"}</span>
                  <span className="tabular-nums text-[var(--text-primary)]">{fmt(l.signedAmount)}</span>
                  {l.classification ? <StatusPill tone="pending">{l.classification.replace(/_/g, " ")}</StatusPill> : <span className="w-20" />}
                  <button type="button" disabled={locked(l.entryDate)} onClick={() => onClassify(l)} className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-40">
                    {l.classification ? "Change" : "Explain"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unmatchedLedger.length > 0 && <p className="text-xs text-[var(--text-secondary)]">Explain each one (an outstanding cheque, a deposit in transit and so on) so the period can be marked reconciled.</p>}
        </section>

        <p className={`rounded px-3 py-2 text-sm ${Math.abs(unexplained) < 0.05 ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)]" : "bg-[var(--status-action-bg)] text-[var(--status-action-text)]"}`}>
          {Math.abs(unexplained) < 0.05 ? "These two lists explain the whole difference." : `After these two lists, ${fmt(unexplained)} is still unexplained. Check the opening balance and the statement dates.`}
        </p>
      </div>
    </div>
  );
}
