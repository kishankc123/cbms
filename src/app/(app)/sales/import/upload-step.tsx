"use client";

import { useRef, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { downloadTemplate } from "./actions";

const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";

export function UploadStep({ busy, onFile }: { busy: boolean; onFile: (file: Blob & { name: string }) => void }) {
  const { reportError, dialog } = useProblem();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  async function template() {
    try {
      const t = await downloadTemplate();
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
        <p className="text-xs text-[var(--text-secondary)]">One row per invoice. Only a date and an amount are needed. Up to 5,000 rows.</p>
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

      <div className={`${card} p-4 text-sm text-[var(--text-secondary)]`}>
        <p className="font-medium text-[var(--text-primary)]">What happens next</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Columns and dates (AD or BS) are matched for you. You only fix what can&apos;t be read.</li>
          <li>Customers in the file are matched to yours; new names are created only if you tick them.</li>
          <li>Invoices are numbered automatically, continuing your sequence, and post exactly like Multi-Invoice.</li>
          <li>You can undo a whole import afterwards.</li>
        </ul>
      </div>
      {dialog}
    </div>
  );
}
