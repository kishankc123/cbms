"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBankAccount, updateBankAccount, type BankAccountInput } from "../actions";

type LedgerOption = { id: string; code: string; name: string };

export type InitialBankAccount = BankAccountInput & { bankAccountId: string; ledgerLabel: string };

export function BankAccountFormModal({
  ledgerOptions,
  initial,
  onClose,
}: {
  ledgerOptions: LedgerOption[];
  initial?: InitialBankAccount;
  onClose: () => void;
}) {
  const router = useRouter();
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? "");
  const [branch, setBranch] = useState(initial?.branch ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "NPR");
  const [chartOfAccountsLink, setChartOfAccountsLink] = useState(initial?.chartOfAccountsLink ?? "");
  const [openingBalance, setOpeningBalance] = useState(initial ? String(initial.openingBalance) : "0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      const payload: BankAccountInput = {
        bankName,
        accountName,
        accountNumber,
        branch,
        currency,
        chartOfAccountsLink,
        openingBalance: parseFloat(openingBalance) || 0,
      };
      if (initial) {
        await updateBankAccount({ ...payload, bankAccountId: initial.bankAccountId });
      } else {
        await createBankAccount(payload);
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{initial ? "Edit bank account" : "Add bank account"}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bank name</label>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Account name</label>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Account number</label>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Currency</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Opening balance</label>
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Ledger account</label>
            {initial ? (
              <input disabled value={initial.ledgerLabel} className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-400" />
            ) : (
              <select
                value={chartOfAccountsLink}
                onChange={(e) => setChartOfAccountsLink(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select ledger account</option>
                {ledgerOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
