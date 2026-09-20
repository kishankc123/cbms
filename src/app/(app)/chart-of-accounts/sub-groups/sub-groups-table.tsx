"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSubGroupAccount } from "../actions";
import { AccountEditModal } from "../account-edit-modal";
import { Balance, DeleteAccountButton, SystemBadge } from "../shared";

type Group = { id: string; code: string; name: string };
type SubGroup = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  isActive: boolean;
  parentAccountId: string | null;
  /** This account's own balance (its group's total includes it). */
  own: number;
  system: boolean;
};

export function SubGroupsTable({ groups, subGroups, groupById }: { groups: Group[]; subGroups: SubGroup[]; groupById: Record<string, Group> }) {
  const router = useRouter();
  const [parentId, setParentId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createSubGroupAccount({ parentAccountId: parentId, name });
      if (!r.ok) return setError(r.error);
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Group</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} required className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[220px]">
            <option value="">Select group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} — {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="rounded border border-gray-300 px-2 py-1.5 text-sm w-56" />
        </div>
        <button type="submit" disabled={busy || !parentId} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
          Add sub-group
        </button>
      </form>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Group</th>
            <th className="px-4 py-2 font-medium text-right">Balance</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {subGroups.map((sg) => (
            <tr key={sg.id} className={`border-t border-gray-100 ${sg.isActive ? "" : "text-gray-400"}`}>
              <td className="px-4 py-2 font-mono">{sg.code}</td>
              <td className="px-4 py-2">
                {sg.name}
                {sg.system && <SystemBadge />}
              </td>
              <td className="px-4 py-2">{sg.parentAccountId ? groupById[sg.parentAccountId]?.name ?? "—" : "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                <Balance value={sg.own} />
              </td>
              <td className="px-4 py-2">{sg.isActive ? "Active" : "Inactive"}</td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-3">
                  <AccountEditModal
                    initial={{ id: sg.id, name: sg.name, isActive: sg.isActive, system: sg.system }}
                    showSubCategory={false}
                    trigger={(open) => (
                      <button type="button" onClick={open} className="text-xs text-[var(--color-primary)] hover:underline">
                        Edit
                      </button>
                    )}
                  />
                  {!sg.system && <DeleteAccountButton id={sg.id} name={sg.name} onError={setError} />}
                </div>
              </td>
            </tr>
          ))}
          {subGroups.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No sub-groups yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
