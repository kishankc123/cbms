"use client";

import { useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { previewStatementFile, previewStatementDates, confirmStatementImport, type StatementPreview, type DatePreview } from "./actions";
import type { ColumnMapping } from "@/lib/banking/normalize-rows";

import { DatePicker } from "@/components/calendar/date-picker";
import { formatAD, formatBS } from "@/lib/calendar";
import type { ImportDateChoice } from "@/lib/banking/import-dates";
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
  const [step, setStep] = useState<"select" | "map" | "dates">("select");
  const [fileName, setFileName] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: "" });
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [saveAsTemplateName, setSaveAsTemplateName] = useState("");
  // How the file's date column is read. Whatever the file uses, only AD dates are stored.
  const [dateChoice, setDateChoice] = useState<ImportDateChoice>("auto");
  const [dayFirst, setDayFirst] = useState(true);
  const [allowMixed, setAllowMixed] = useState(false);
  const [datePreview, setDatePreview] = useState<DatePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const { report, dialog } = useProblem();
  const [result, setResult] = useState<{ imported: number; duplicates: number; skipped: number } | null>(null);

  async function handleFileSelect(file: File) {
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
      report(e instanceof Error ? e.message : "Failed to read this file", null);
    } finally {
      setLoading(false);
    }
  }

  async function loadDatePreview(next: { choice?: ImportDateChoice; dayFirst?: boolean; allowMixed?: boolean } = {}) {
    const choice = next.choice ?? dateChoice;
    const first = next.dayFirst ?? dayFirst;
    const mixedOk = next.allowMixed ?? allowMixed;
    setLoading(true);
    try {
      const p = await previewStatementDates({ bankAccountId, fileName, base64, dateColumn: mapping.date, choice, dayFirst: first, allowMixed: mixedOk });
      setDatePreview(p);
      setDateChoice(choice);
      setDayFirst(first);
      setAllowMixed(mixedOk);
      setStep("dates");
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to read the dates", null);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
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
        dateChoice,
        dayFirst,
        allowMixedDates: allowMixed,
      });
      setResult(res);
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to import", null);
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
                <DatePicker value={periodStart} onChange={(v) => setPeriodStart(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Statement period end</label>
                <DatePicker value={periodEnd} onChange={(v) => setPeriodEnd(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
            </div>

            <DateFormatControls choice={dateChoice} dayFirst={dayFirst} onChoice={(c) => setDateChoice(c)} onDayFirst={(v) => setDayFirst(v)} />

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

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStep("select")} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Back
              </button>
              <button
                type="button"
                disabled={loading || !mapping.date || !periodStart || !periodEnd || (!mapping.debit && !mapping.credit && !mapping.amount)}
                onClick={() => loadDatePreview()}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
              >
                {loading ? "Reading dates..." : "Next: Review dates"}
              </button>
            </div>
          </div>
        ) : step === "dates" && datePreview ? (
          <DateReview
            preview={datePreview}
            dateColumn={mapping.date}
            choice={dateChoice}
            dayFirst={dayFirst}
            allowMixed={allowMixed}
            loading={loading}
            onReload={loadDatePreview}
            onChangeFormat={() => setStep("map")}
            onCancel={onClose}
            onConfirm={handleImport}
          />
        ) : null}
      </div>
      {dialog}
    </div>
  );
}

function DateFormatControls({ choice, dayFirst, onChoice, onDayFirst }: { choice: ImportDateChoice; dayFirst: boolean; onChoice: (c: ImportDateChoice) => void; onDayFirst: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Date format in file</label>
        <select value={choice} onChange={(e) => onChoice(e.target.value as ImportDateChoice)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
          <option value="auto">Auto-detect (AD or BS)</option>
          <option value="AD">AD (Gregorian)</option>
          <option value="BS">BS (Bikram Sambat)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Numeric dates like 03/04/2026 are</label>
        <select value={dayFirst ? "dmy" : "mdy"} onChange={(e) => onDayFirst(e.target.value === "dmy")} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
          <option value="dmy">Day first (DD/MM/YYYY)</option>
          <option value="mdy">Month first (MM/DD/YYYY)</option>
        </select>
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  AD: "bg-blue-50 text-blue-700",
  BS: "bg-purple-50 text-purple-700",
  ambiguous: "bg-amber-50 text-amber-700",
  invalid: "bg-red-50 text-red-700",
};

function DateReview({
  preview,
  dateColumn,
  choice,
  dayFirst,
  allowMixed,
  loading,
  onReload,
  onChangeFormat,
  onCancel,
  onConfirm,
}: {
  preview: DatePreview;
  dateColumn: string;
  choice: ImportDateChoice;
  dayFirst: boolean;
  allowMixed: boolean;
  loading: boolean;
  onReload: (next?: { choice?: ImportDateChoice; dayFirst?: boolean; allowMixed?: boolean }) => void;
  onChangeFormat: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { counts } = preview;
  const detectedText =
    preview.detected === "AD" || preview.detected === "BS"
      ? `${preview.detected} dates (${Math.round(preview.confidence * 100)}% confidence)`
      : preview.detected === "mixed"
        ? "Mixed AD and BS dates"
        : preview.detected === "ambiguous"
          ? "Could be AD or BS"
          : "No dates found";
  const summary =
    choice === "auto"
      ? `Detected: ${detectedText}`
      : `Reading as ${choice} dates (chosen by you)${preview.detected !== choice && preview.detected !== "none" ? ` — the file looks like: ${detectedText}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
        <p className="font-medium text-gray-900">{summary}</p>
        <p className="text-xs text-gray-500">
          Column &quot;{dateColumn}&quot; · {counts.AD} AD · {counts.BS} BS
          {counts.ambiguous > 0 && ` · ${counts.ambiguous} ambiguous`}
          {counts.invalid > 0 && ` · ${counts.invalid} unreadable (will be skipped)`} · Dates are stored as AD either way.
        </p>
      </div>

      <DateFormatControls choice={choice} dayFirst={dayFirst} onChoice={(c) => onReload({ choice: c })} onDayFirst={(v) => onReload({ dayFirst: v })} />

      {preview.mixed && (
        <label className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <input type="checkbox" checked={allowMixed} onChange={(e) => onReload({ allowMixed: e.target.checked })} className="mt-0.5" />
          <span>This file mixes AD and BS dates. Review the table below, then tick to import each row using its own detected calendar — or pick AD or BS above to force one.</span>
        </label>
      )}
      {preview.hasDayMonthAmbiguity && <p className="text-xs text-amber-700">Some dates could be read day-first or month-first. Check the converted dates below, or change the numeric format above.</p>}
      {preview.hasProjected && <p className="text-xs text-amber-700">Some BS dates are beyond the years the calendar data is verified for. They are converted from projected month lengths.</p>}

      <div className="overflow-x-auto rounded border border-gray-200 max-h-72">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr className="text-left text-gray-500">
              <th className="px-2 py-1 font-medium">Row</th>
              <th className="px-2 py-1 font-medium">Original</th>
              <th className="px-2 py-1 font-medium">Detected</th>
              <th className="px-2 py-1 font-medium">AD</th>
              <th className="px-2 py-1 font-medium">BS</th>
              <th className="px-2 py-1 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {preview.shown.map((r) => (
              <tr key={r.rowNumber} className="border-t border-gray-100">
                <td className="px-2 py-1 text-gray-400">{r.rowNumber}</td>
                <td className="px-2 py-1 font-mono whitespace-nowrap">{r.raw || "—"}</td>
                <td className="px-2 py-1">
                  <span className={`rounded px-1.5 py-0.5 capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-2 py-1 whitespace-nowrap">{r.iso ? formatAD(r.iso) : "—"}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.iso ? formatBS(r.iso) : "—"}</td>
                <td className="px-2 py-1 text-gray-500">{r.note ?? (r.dayMonthAmbiguous ? "Day/month order assumed" : r.projected ? "Projected BS date" : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-2 py-1 text-xs text-gray-400">
          Showing {preview.shown.length} of {preview.totalRows} rows (all problem rows are included)
        </p>
      </div>

      {preview.blocking && (
        <p className="text-sm text-amber-700">
          {counts.ambiguous > 0 ? "Some dates could be AD or BS. Choose the format above." : preview.mixed ? "Confirm how to treat the mixed dates above." : "No dates could be read from this column."}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button type="button" onClick={onChangeFormat} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Change Format
        </button>
        <button
          type="button"
          disabled={loading || preview.blocking}
          onClick={onConfirm}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {loading ? "Working..." : "Confirm & Import"}
        </button>
      </div>
    </div>
  );
}
