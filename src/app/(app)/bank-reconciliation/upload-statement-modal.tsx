"use client";

import { useState } from "react";
import { previewStatementFile, confirmStatementImport, type StatementPreview } from "./actions";
import type { ColumnMapping } from "@/lib/banking/normalize-rows";

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "amount", label: "Amount" },
  { key: "reference", label: "Reference" },
  { key: "balance", label: "Balance" },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function UploadStatementModal({
  bankAccountId,
  onClose,
  onImported,
}: {
  bankAccountId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<"select" | "map" | "preview">("select");
  const [fileName, setFileName] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: "" });
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [saveAsTemplateName, setSaveAsTemplateName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; skipped: number } | null>(null);

  async function handleFileSelect(file: File) {
    setError(null);
    setLoading(true);
    try {
      const b64 = await fileToBase64(file);
      const p = await previewStatementFile({ bankAccountId, fileName: file.name, base64: b64 });
      setFileName(file.name);
      setBase64(b64);
      setPreview(p);
      setMapping(p.suggestedMapping ?? { date: "" });
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read this file");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      const res = await confirmStatementImport({
        bankAccountId,
        fileName,
        base64,
        mapping,
        statementPeriodStart: periodStart,
        statementPeriodEnd: periodEnd,
        saveAsTemplateName,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-3xl rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Upload Statement</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {result ? (
          <div className="space-y-4 text-center py-6">
            <p className="text-sm text-gray-900">
              Imported {result.imported} transaction{result.imported === 1 ? "" : "s"}.
              {result.duplicates > 0 && ` Skipped ${result.duplicates} already-imported duplicate${result.duplicates === 1 ? "" : "s"}.`}
              {result.skipped > 0 && ` ${result.skipped} row(s) couldn't be read with this mapping.`}
            </p>
            <button
              type="button"
              onClick={() => {
                onImported();
                onClose();
              }}
              className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-6 py-1.5"
            >
              Done
            </button>
          </div>
        ) : step === "select" ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Select a CSV or Excel (.xlsx) statement file to import.</p>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="text-sm"
            />
            {loading && <p className="text-sm text-gray-400">Reading file...</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        ) : step === "map" && preview ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Map each field to a column from {fileName}.</p>
            <div className="grid grid-cols-2 gap-3">
              {MAPPING_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs text-gray-500 mb-1">
                    {f.label}
                    {f.required && " *"}
                  </label>
                  <select
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Not mapped</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Statement period start</label>
                <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Statement period end</label>
                <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Save this mapping as a template (optional)</label>
              <input
                value={saveAsTemplateName}
                onChange={(e) => setSaveAsTemplateName(e.target.value)}
                placeholder="e.g. Nabil Bank CSV"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>

            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {preview.headers.map((h) => (
                      <th key={h} className="px-2 py-1 text-left font-medium text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      {row.map((c, j) => (
                        <td key={j} className="px-2 py-1 whitespace-nowrap">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-2 py-1 text-xs text-gray-400">Showing {preview.sampleRows.length} of {preview.totalRows} rows</p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStep("select")} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Back
              </button>
              <button
                type="button"
                disabled={loading || !mapping.date || !periodStart || !periodEnd}
                onClick={handleImport}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
              >
                {loading ? "Importing..." : "Confirm Import"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
