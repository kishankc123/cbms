"use client";

import { useState } from "react";
import { createManualJournalEntry } from "./actions";

import { DateField } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Account = { id: string; code: string; name: string };

const EMPTY_ROW = { accountId: "", debitAmount: "", creditAmount: "", description: "" };

export function JournalEntryForm({ accounts }: { accounts: Account[] }) {
  const [rows, setRows] = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]);

  const totalDebit = rows.reduce((s, r) => s + (parseFloat(r.debitAmount) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (parseFloat(r.creditAmount) || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  function updateRow(i: number, field: keyof typeof EMPTY_ROW, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  return (
    <form
      action={createManualJournalEntry}
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Entry date</label>
          <DateField name="entryDate" required defaultValue={todayIso()} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Reference #</label>
          <input name="referenceNumber" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">Memo</label>
          <input name="memo" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="pb-1 font-medium">Account</th>
            <th className="pb-1 font-medium">Description</th>
            <th className="pb-1 font-medium w-28">Debit</th>
            <th className="pb-1 font-medium w-28">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <select
                  name="accountId"
                  value={row.accountId}
                  onChange={(e) => updateRow(i, "accountId", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-2">
                <input
                  name="lineDescription"
                  value={row.description}
                  onChange={(e) => updateRow(i, "description", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  name="debitAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.debitAmount}
                  onChange={(e) => updateRow(i, "debitAmount", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </td>
              <td className="py-1">
                <input
                  name="creditAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.creditAmount}
                  onChange={(e) => updateRow(i, "creditAmount", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          + Add line
        </button>

        <div className="text-sm">
          <span className="text-gray-500 mr-3">
            Debit {totalDebit.toFixed(2)} / Credit {totalCredit.toFixed(2)}
          </span>
          {!balanced && <span className="text-red-600">Not balanced</span>}
        </div>
      </div>

      <button
        type="submit"
        disabled={!balanced}
        className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-40"
      >
        Post entry
      </button>
    </form>
  );
}
