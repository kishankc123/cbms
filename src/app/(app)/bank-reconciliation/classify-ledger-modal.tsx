"use client";

import { useState } from "react";
import { classifyUnmatchedLedgerLine, type UnmatchedLedgerRow } from "./actions";

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
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await classifyUnmatchedLedgerLine({ journalLineId: line.journalLineId, bankAccountId, classification, notes });
      onClassified();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to classify");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Classify unmatched transaction</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-600">
          {line.entryDate} — {line.memo || line.description || "—"} — {line.signedAmount.toFixed(2)}
        </p>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Classification</label>
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value as typeof classification)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
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
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
