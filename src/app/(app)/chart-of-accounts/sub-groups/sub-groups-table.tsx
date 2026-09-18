"use client";

import { createSubGroupAccount, deleteAccount } from "../actions";
import { AccountEditModal } from "../account-edit-modal";

type Group = { id: string; code: string; name: string };
type SubGroup = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  isActive: boolean;
  parentAccountId: string | null;
};

export function SubGroupsTable({
  groups,
  subGroups,
  groupById,
}: {
  groups: Group[];
  subGroups: SubGroup[];
  groupById: Record<string, Group>;
}) {
  return (
    <div className="space-y-3">
      <form
        action={createSubGroupAccount}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div>
          <label className="block text-xs text-gray-500 mb-1">Group</label>
          <select
            name="parentAccountId"
            required
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[220px]"
          >
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
          <input name="name" required className="rounded border border-gray-300 px-2 py-1.5 text-sm w-56" />
        </div>
        <button
          type="submit"
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          Add sub-group
        </button>
      </form>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Group</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {subGroups.map((sg) => (
            <tr key={sg.id} className="border-t border-gray-100">
              <td className="px-4 py-2 font-mono">{sg.code}</td>
              <td className="px-4 py-2">{sg.name}</td>
              <td className="px-4 py-2">
                {sg.parentAccountId ? groupById[sg.parentAccountId]?.name ?? "—" : "—"}
              </td>
              <td className="px-4 py-2">{sg.isActive ? "Active" : "Inactive"}</td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-3">
                  <AccountEditModal
                    initial={{ id: sg.id, name: sg.name, isActive: sg.isActive }}
                    showSubCategory={false}
                    trigger={(open) => (
                      <button type="button" onClick={open} className="text-xs text-[var(--color-primary)] hover:underline">
                        Edit
                      </button>
                    )}
                  />
                  <form
                    action={deleteAccount}
                    onSubmit={(e) => {
                      if (!confirm(`Delete "${sg.name}"? This can't be undone.`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="id" value={sg.id} />
                    <button type="submit" className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {subGroups.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                No sub-groups yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
