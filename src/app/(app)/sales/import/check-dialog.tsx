"use client";


const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The result of "Check only": exactly what an import would do right now, with nothing created or posted.
export type CheckSummary = { wouldImport: number; total: number; tax: number; newParties: string[]; skipped: { rowNumber: number; reason: string }[] };

export function CheckDialog({ result, onClose, onImport, busy, noun, partyLabel }: { result: CheckSummary; onClose: () => void; onImport: () => void; busy: boolean; noun: string; partyLabel: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-10 w-full max-w-lg rounded-lg bg-[var(--card-bg)] p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Check only: nothing was imported</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">This is what the import would do with the file as it stands now.</p>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">{noun[0].toUpperCase() + noun.slice(1)}s that would be created</dt>
            <dd className="font-medium tabular-nums">{result.wouldImport}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">VAT</dt>
            <dd className="tabular-nums">{money(result.tax)}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--card-border)] pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(result.total)}</dd>
          </div>
        </dl>

        {result.newParties.length > 0 && (
          <div className="mt-4 text-sm">
            <p className="font-medium text-[var(--text-primary)]">
              New {partyLabel} that would be added ({result.newParties.length})
            </p>
            <p className="text-[var(--text-secondary)]">
              {result.newParties.slice(0, 8).join(", ")}
              {result.newParties.length > 8 ? ` and ${result.newParties.length - 8} more` : ""}
            </p>
          </div>
        )}

        {result.skipped.length > 0 && (
          <div className="mt-4 text-sm">
            <p className="font-medium text-[var(--text-primary)]">
              {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} would not be imported
            </p>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[var(--text-secondary)]">
              {result.skipped.slice(0, 30).map((s) => (
                <li key={s.rowNumber}>
                  Row {s.rowNumber}: {s.reason}
                </li>
              ))}
              {result.skipped.length > 30 && <li>and {result.skipped.length - 30} more…</li>}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Close
          </button>
          <button type="button" disabled={busy || result.wouldImport === 0} onClick={onImport} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {busy ? "Importing..." : `Import ${result.wouldImport} now`}
          </button>
        </div>
      </div>
    </div>
  );
}
