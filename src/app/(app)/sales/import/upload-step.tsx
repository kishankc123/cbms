"use client";

import { useRef, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { pastedToCsv } from "@/lib/sales/import/paste";
import type { ColumnGuideRow } from "@/lib/sales/import/column-guide";

const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";

export function UploadStep({ busy, onFile, onTemplate, rowNoun, notes, pasteExample, guide }: { busy: boolean; onFile: (file: Blob & { name: string }) => void; onTemplate: () => Promise<{ fileName: string; base64: string }>; rowNoun: string; notes: string[]; pasteExample: string; guide: ColumnGuideRow[] }) {
  const { reportError, dialog } = useProblem();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [guiding, setGuiding] = useState(false);

  function usePasted() {
    const csv = pastedToCsv(pasted);
    if (!csv) return reportError(new Error("Paste the cells including the header row and at least one data row."));
    onFile(new File([csv], `pasted-${rowNoun === "bill" ? "purchases" : rowNoun === "expense" ? "expenses" : "sales"}.csv`, { type: "text/csv" }));
  }

  async function template() {
    try {
      const t = await onTemplate();
      const bytes = Uint8Array.from(atob(t.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = t.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={`${card} flex flex-col items-center gap-3 border-dashed p-10 text-center ${over ? "border-[var(--color-primary)] bg-[var(--surface-muted-bg)]" : ""}`}
      >
        <p className="text-sm font-medium text-[var(--text-primary)]">{busy ? "Reading your file..." : "Drop a CSV or Excel file here"}</p>
        <p className="text-xs text-[var(--text-secondary)]">One row per {rowNoun}. Only a date and an amount are needed.</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            Choose file
          </button>
          <button type="button" onClick={template} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Download template
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className={`${card} p-4`}>
        <button type="button" onClick={() => setPasting((v) => !v)} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
          {pasting ? "Hide paste box" : "Or paste cells from Excel"}
        </button>
        {pasting && (
          <div className="mt-3 space-y-2">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder={`Copy the cells in Excel or Google Sheets, header row included, and paste here.\n${pasteExample}`}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-[var(--color-primary)] focus:outline-none"
            />
            <button type="button" disabled={busy || !pasted.trim()} onClick={usePasted} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
              Use pasted data
            </button>
          </div>
        )}
      </div>

      <div className={`${card} p-4`}>
        <button type="button" onClick={() => setGuiding((v) => !v)} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
          {guiding ? "Hide the column guide" : "Column guide: what each column can hold"}
        </button>
        {guiding && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Column</th>
                  <th className="px-3 py-2 font-medium">Needed</th>
                  <th className="px-3 py-2 font-medium">What to enter</th>
                  <th className="px-3 py-2 font-medium">Example</th>
                  <th className="px-3 py-2 font-medium">Also found as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-[var(--text-secondary)]">
                {guide.map((g) => (
                  <tr key={g.column}>
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{g.column}</td>
                    <td className={`px-3 py-2 ${g.needed === "Required" ? "font-medium text-[var(--text-primary)]" : ""}`}>{g.needed}</td>
                    <td className="px-3 py-2">{g.accepts}</td>
                    <td className="px-3 py-2 tabular-nums">{g.example}</td>
                    <td className="px-3 py-2">{g.alsoRead}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">The first row of the file must be the column names. The order of columns does not matter, and columns you do not have can be left out.</p>
          </div>
        )}
      </div>

      <div className={`${card} p-4 text-sm text-[var(--text-secondary)]`}>
        <p className="font-medium text-[var(--text-primary)]">What happens next</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      {dialog}
    </div>
  );
}
