"use client";

import { useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { classifyUnmatchedLedgerLine, type UnmatchedLedgerRow } from "./actions";

import { D } from "@/components/calendar/date-text";
const CLASSIFICATIONS: { value: Parameters<typeof classifyUnmatchedLedgerLine>[0]["classification"]; label: string }[] = [
  { value: "outstanding_cheque", label: "Outstanding cheque" },
  { value: "pending_bank_transaction", label: "Pending bank transaction" },
  { value: "not_yet_cleared", label: "Transaction not yet cleared" },
  { value: "timing_difference", label: "Timing difference" },
  { value: "incorrect_transaction", label: "Incorrect transaction" },
];

export function ClassifyLedgerModal({
  bankAccountId,
  line,
  onClose,
  onClassified,
}: {
  bankAccountId: string;
  line: UnmatchedLedgerRow;
  onClose: () => void;
  onClassified: () => void;
}) {
  const [classification, setClassification] = useState<(typeof CLASSIFICATIONS)[number]["value"]>(
    (line.classification as (typeof CLASSIFICATIONS)[number]["value"]) ?? "outstanding_cheque"
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { report, dialog } = useProblem();

  async function handleSubmit() {
    setSaving(true);
    try {
      await classifyUnmatchedLedgerLine({ journalLineId: line.journalLineId, bankAccountId, classification, notes });
      onClassified();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to classify", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Classify unmatched transaction</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-600">
          <D value={line.entryDate} /> — {line.memo || line.description || "—"} — {line.signedAmount.toFixed(2)}
        </p>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Classification</label>
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value as typeof classification)}
            className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full"
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
        </div>


        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
