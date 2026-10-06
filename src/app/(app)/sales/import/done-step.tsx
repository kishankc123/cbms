"use client";

import Link from "next/link";
import type { RunResult } from "@/lib/sales/import/types";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DoneStep({ result, onAnother }: { result: Extract<RunResult, { ok: true }>; onAnother: () => void }) {
  const stopped = result.stopped;

  function downloadSkipped() {
    const lines = ["Row,Reason", ...result.skipped.map((s) => `${s.rowNumber},"${s.reason.replace(/"/g, '""')}"`)];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "rows-not-imported.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <section className={`rounded-lg border p-6 ${stopped ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
        <p className={`text-lg font-semibold ${stopped ? "text-amber-900" : "text-green-900"}`}>
          {result.imported} invoice{result.imported === 1 ? "" : "s"} imported · {money(result.total)}
        </p>
        {stopped && (
          <p className="mt-1 text-sm text-amber-900">
            The import stopped at row {stopped.rowNumber}: {stopped.message}. What was imported before that is in the books; fix the problem and import the remaining rows, or undo this import from Previous imports.
          </p>
        )}
        {result.customersCreated.length > 0 && (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            New customers created: {result.customersCreated.slice(0, 6).join(", ")}
            {result.customersCreated.length > 6 ? ` and ${result.customersCreated.length - 6} more` : ""}.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href="/sales/invoices" className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]">
            View invoices
          </Link>
          <button type="button" onClick={onAnother} className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Import another file
          </button>
        </div>
      </section>

      {result.skipped.length > 0 && (
        <section className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} not imported</h2>
            <button type="button" onClick={downloadSkipped} className="text-sm text-[var(--color-primary)] hover:underline">
              Download list
            </button>
          </div>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm text-[var(--text-secondary)]">
            {result.skipped.slice(0, 100).map((s) => (
              <li key={s.rowNumber}>
                Row {s.rowNumber}: {s.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
