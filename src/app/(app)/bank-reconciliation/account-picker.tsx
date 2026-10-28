"use client";

import { useState } from "react";

// Choose the account a transaction belongs to in three short steps: the Group (Assets, Income, Expenses...), the Ledger (the
// heading inside it), then the Account. Only accounts that can be posted to are offered: not a heading that has sub-accounts, not
// this bank account itself, and not the customer and supplier accounts (those are settled through Payments).

export type AccountOption = { id: string; code: string; name: string; category: string; subCategory: string | null; hasChildren: boolean };

const GROUPS: { key: string; label: string }[] = [
  { key: "asset", label: "Assets" },
  { key: "liability", label: "Liabilities" },
  { key: "equity", label: "Equity" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expenses" },
];
const OTHER = "Other";
const field = "w-full rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1.5 text-sm text-[var(--text-primary)] disabled:opacity-50";

/** Accounts money can be recorded against from a bank line, leaving out the bank account itself. */
export const postableAccounts = (options: AccountOption[], bankLedgerId: string | null) =>
  options.filter((o) => !o.hasChildren && o.id !== bankLedgerId && !["1100", "2000"].some((c) => o.code === c || o.code.startsWith(c + ".")));

export function AccountPicker({ options, value, onChange }: { options: AccountOption[]; value: string; onChange: (accountId: string) => void }) {
  const chosen = options.find((o) => o.id === value);
  const [group, setGroup] = useState(chosen?.category ?? "");
  const [ledger, setLedger] = useState(chosen ? chosen.subCategory ?? OTHER : "");
  const inGroup = options.filter((o) => o.category === group);
  const ledgers = [...new Set(inGroup.map((o) => o.subCategory ?? OTHER))];
  const accounts = inGroup.filter((o) => (o.subCategory ?? OTHER) === ledger);

  // Each box narrows the next one; only the last one sets the account.
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <select
        className={field}
        value={group}
        onChange={(e) => {
          setGroup(e.target.value);
          setLedger("");
          onChange("");
        }}
      >
        <option value="">Group</option>
        {GROUPS.filter((g) => options.some((o) => o.category === g.key)).map((g) => (
          <option key={g.key} value={g.key}>
            {g.label}
          </option>
        ))}
      </select>
      <select
        className={field}
        value={ledger}
        disabled={!group}
        onChange={(e) => {
          setLedger(e.target.value);
          onChange("");
        }}
      >
        <option value="">Ledger</option>
        {ledgers.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <select className={field} value={value} disabled={!ledger} onChange={(e) => onChange(e.target.value)}>
        <option value="">Account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} — {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
