"use client";

import { useState } from "react";
import { D } from "@/components/calendar/date-text";
import { useProblem } from "@/components/problem-dialog";
import { setLineFlag, type StatementLineRow } from "./actions";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

/** The small flag icon, filled when the line is flagged. */
export function FlagIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

/** Flag a bank line for review with a note saying why, or take the flag off. It only marks the line for a second look. */
export function FlagDialog({ line, onClose, onDone }: { line: StatementLineRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(line.flagNote ?? "");
  const [busy, setBusy] = useState(false);
  const { report, dialog } = useProblem();

  async function save(flagged: boolean) {
    setBusy(true);
    try {
      await setLineFlag({ statementLineId: line.id, flagged, note });
      onDone();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "The flag couldn't be saved.", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm space-y-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-lg">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
          <span className="text-red-600">
            <FlagIcon filled />
          </span>
          {line.flagged ? "Flagged for review" : "Flag this transaction"}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <D value={line.transactionDate} /> · {line.description || "—"} · <span className="tabular-nums">{fmt(line.amount)}</span>
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="Why does this need a second look? (optional)"
          className="w-full rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
        />
        <div className="flex items-center justify-between gap-2">
          {line.flagged ? (
            <button type="button" disabled={busy} onClick={() => save(false)} className="text-sm text-red-600 hover:underline disabled:opacity-50">
              Remove flag
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => save(true)} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
              {line.flagged ? "Save note" : "Flag"}
            </button>
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}
