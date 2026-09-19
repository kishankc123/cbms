"use client";

import { useState } from "react";
import { createBankTransaction, type StatementLineRow } from "./actions";

type OffsetAccount = { id: string; code: string; name: string; category: string };

const TYPES: { value: "payment" | "receipt" | "bank_charge" | "transfer" | "other"; label: string }[] = [
  { value: "payment", label: "Payment" },
  { value: "receipt", label: "Receipt" },
  { value: "bank_charge", label: "Bank charge" },
  { value: "transfer", label: "Transfer" },
  { value: "other", label: "Other" },
];

export function CreateBankTransactionModal({
  bankAccountId,
  line,
  offsetAccounts,
  onClose,
  onCreated,
}: {
  bankAccountId: string;
  line: StatementLineRow;
  offsetAccounts: OffsetAccount[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("other");
  const [description, setDescription] = useState(line.description ?? "");
  const [offsetAccountId, setOffsetAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!offsetAccountId) {
      setError("Select the offset account");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createBankTransaction({ statementLineId: line.id, bankAccountId, type, description, offsetAccountId });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create transaction");
    } finally {
      setSaving(false);
    }
  }

  const moneyIn = line.amount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Create transaction</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-600">
          {line.transactionDate} — {line.description || "—"} —{" "}
          <span className={moneyIn ? "text-green-600" : "text-red-600"}>
            {moneyIn ? "+" : ""}
            {line.amount.toFixed(2)}
          </span>
        </p>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Transaction type</label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            {moneyIn ? "Where did this money come from?" : "What was this paid for?"}
          </label>
          <select value={offsetAccountId} onChange={(e) => setOffsetAccountId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Select account</option>
            {offsetAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
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
            {saving ? "Saving..." : "Create & Match"}
          </button>
        </div>
      </div>
    </div>
  );
}
