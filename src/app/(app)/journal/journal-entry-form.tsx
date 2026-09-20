"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createManualJournalEntry } from "./actions";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";

type Account = { id: string; code: string; name: string };

const EMPTY_ROW = { accountId: "", debitAmount: "", creditAmount: "" };
const cents = (n: number) => Math.round(n * 100);

export function JournalEntryForm({ accounts, nextVoucher }: { accounts: Account[]; nextVoucher: string }) {
  const router = useRouter();
  const [entryDate, setEntryDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);

  const totalDebit = rows.reduce((s, r) => s + (parseFloat(r.debitAmount) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (parseFloat(r.creditAmount) || 0), 0);
  const balanced = cents(totalDebit) === cents(totalCredit) && totalDebit > 0;

  function updateRow(i: number, field: keyof typeof EMPTY_ROW, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const result = await createManualJournalEntry({
        entryDate,
        description,
        lines: rows.map((r) => ({ accountId: r.accountId, debitAmount: parseFloat(r.debitAmount) || 0, creditAmount: parseFloat(r.creditAmount) || 0 })),
      });
      if (!result.ok) return setError(result.error);
      setRecorded(result.voucherNumber);
      // Ready for the next entry.
      setDescription("");
      setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Voucher no.</label>
          <input readOnly value={nextVoucher} title="Generated automatically when the entry is posted" className="w-32 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-600" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Entry date</label>
          <DatePicker value={entryDate} onChange={setEntryDate} required className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="pb-1 font-medium">Account</th>
            <th className="pb-1 font-medium w-32">Debit</th>
            <th className="pb-1 font-medium w-32">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <select value={row.accountId} onChange={(e) => updateRow(i, "accountId", e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-2">
                <input type="number" step="0.01" min="0" value={row.debitAmount} onChange={(e) => updateRow(i, "debitAmount", e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </td>
              <td className="py-1">
                <input type="number" step="0.01" min="0" value={row.creditAmount} onChange={(e) => updateRow(i, "creditAmount", e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])} className="text-sm text-gray-600 hover:text-gray-900">
          + Add line
        </button>

        <div className="text-sm">
          <span className="text-gray-500 mr-3">
            Debit {totalDebit.toFixed(2)} / Credit {totalCredit.toFixed(2)}
          </span>
          {!balanced && <span className="text-red-600">Not balanced</span>}
        </div>
      </div>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button type="button" onClick={post} disabled={!balanced || busy} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-40">
        {busy ? "Posting..." : "Post entry"}
      </button>

      {recorded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setRecorded(null)} />
          <div role="dialog" aria-modal="true" aria-label="Transaction recorded" className="relative w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-lg space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-lg text-green-700">✓</div>
            <h2 className="text-base font-semibold text-gray-900">Transaction recorded</h2>
            <p className="text-sm text-gray-500">
              Your journal entry has been posted as voucher <span className="font-medium text-gray-900">{recorded}</span>.
            </p>
            <button type="button" autoFocus onClick={() => setRecorded(null)} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-6 py-1.5">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
