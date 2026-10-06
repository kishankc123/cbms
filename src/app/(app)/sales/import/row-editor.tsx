"use client";

import { useState } from "react";

const field = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none";

// Corrects one row of the file in place: what is typed replaces that row's cell, and the row is checked again. The file
// itself is never changed.
export type EditorField = { key: string; label: string; required: boolean };
export type EditorRow = { rowNumber: number; status: string; messages: string[]; raw: Partial<Record<string, string>> };

export function RowEditor({ row, fields, edited, onSave, onRevert, onClose }: { row: EditorRow; fields: EditorField[]; edited: boolean; onSave: (values: Record<string, string>) => void; onRevert: () => void; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, row.raw[f.key] ?? ""])));

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-10 w-full max-w-xl rounded-lg bg-[var(--card-bg)] p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Fix row {row.rowNumber}</h2>
        {row.messages.length > 0 && row.status !== "ready" && <p className="mt-1 text-sm text-red-600">{row.messages.join(" ")}</p>}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className={f.key === "customer" || f.key === "supplier" || f.key === "description" ? "sm:col-span-2" : ""}>
              <label className="mb-1 block text-xs text-gray-500">
                {f.label}
                {f.required ? " *" : ""}
              </label>
              <input className={field} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.key === "billType" ? "Taxable or Zero rated" : f.key === "date" ? "e.g. 2083-04-15" : ""} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">Only this import changes; your file is untouched.</p>

        <div className="mt-5 flex items-center justify-end gap-3">
          {edited && (
            <button type="button" onClick={onRevert} className="mr-auto text-sm text-[var(--text-secondary)] hover:underline">
              Undo my changes to this row
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" onClick={() => onSave(values)} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]">
            Save and check
          </button>
        </div>
      </div>
    </div>
  );
}
