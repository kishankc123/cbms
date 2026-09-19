"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setBankAccountActive } from "../actions";
import { BankAccountFormModal, type InitialBankAccount } from "./bank-account-form-modal";

type BankAccountRow = {
  id: string;
  bankName: string | null;
  accountName: string;
  accountNumber: string | null;
  branch: string | null;
  currency: string;
  chartOfAccountsLink: string;
  openingBalance: string;
  isActive: boolean;
  ledgerCode: string;
  ledgerName: string;
};

type LedgerOption = { id: string; code: string; name: string };

export function BankAccountsTable({ bankAccounts, ledgerOptions }: { bankAccounts: BankAccountRow[]; ledgerOptions: LedgerOption[] }) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<InitialBankAccount | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleActive(row: BankAccountRow) {
    setToggling(row.id);
    try {
      await setBankAccountActive({ bankAccountId: row.id, isActive: !row.isActive });
      router.refresh();
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          + Add bank account
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Bank</th>
            <th className="px-4 py-2 font-medium">Account name</th>
            <th className="px-4 py-2 font-medium">Account number</th>
            <th className="px-4 py-2 font-medium">Branch</th>
            <th className="px-4 py-2 font-medium">Ledger account</th>
            <th className="px-4 py-2 font-medium">Currency</th>
            <th className="px-4 py-2 font-medium">Opening balance</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {bankAccounts.map((b) => (
            <tr key={b.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{b.bankName ?? "—"}</td>
              <td className="px-4 py-2">{b.accountName}</td>
              <td className="px-4 py-2">{b.accountNumber ?? "—"}</td>
              <td className="px-4 py-2">{b.branch ?? "—"}</td>
              <td className="px-4 py-2">
                {b.ledgerCode} — {b.ledgerName}
              </td>
              <td className="px-4 py-2">{b.currency}</td>
              <td className="px-4 py-2">{Number(b.openingBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-2">{b.isActive ? "Active" : "Inactive"}</td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      bankAccountId: b.id,
                      bankName: b.bankName ?? "",
                      accountName: b.accountName,
                      accountNumber: b.accountNumber ?? "",
                      branch: b.branch ?? "",
                      currency: b.currency,
                      chartOfAccountsLink: b.chartOfAccountsLink,
                      openingBalance: Number(b.openingBalance),
                      ledgerLabel: `${b.ledgerCode} — ${b.ledgerName}`,
                    })
                  }
                  className="text-xs text-gray-600 hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={toggling === b.id}
                  onClick={() => {
                    if (b.isActive && !confirm(`Deactivate ${b.accountName}? It will no longer be usable for new transactions.`)) return;
                    toggleActive(b);
                  }}
                  className="text-xs text-red-600 hover:underline disabled:opacity-40"
                >
                  {b.isActive ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
          {bankAccounts.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-6 text-center text-gray-400">
                No bank accounts yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showNew && <BankAccountFormModal ledgerOptions={ledgerOptions} onClose={() => setShowNew(false)} />}
      {editing && <BankAccountFormModal ledgerOptions={ledgerOptions} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
