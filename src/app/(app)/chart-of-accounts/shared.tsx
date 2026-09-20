"use client";

import { useRouter } from "next/navigation";
import { deleteAccount } from "./actions";

export const TYPE_LABEL: Record<string, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };

/** A balance signed to the account's normal side; a negative one (the "wrong" side) is shown in red. */
export function Balance({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-gray-400">0.00</span>;
  return <span className={value < 0 ? "text-red-600" : ""}>{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

export function SystemBadge() {
  return (
    <span title="Other parts of the system rely on this account, so it can't be deleted or deactivated" className="ml-2 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
      System
    </span>
  );
}

export function DeleteAccountButton({ id, name, onError }: { id: string; name: string; onError: (message: string) => void }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-xs text-red-600 hover:underline"
      onClick={async () => {
        if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
        const r = await deleteAccount(id);
        if (!r.ok) onError(r.error);
        else router.refresh();
      }}
    >
      Delete
    </button>
  );
}
