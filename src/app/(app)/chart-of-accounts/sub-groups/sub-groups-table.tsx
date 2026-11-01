"use client";

import { AddAccountDialog, type GroupChoice } from "../add-account-dialog";
import { useProblem } from "@/components/problem-dialog";
import { AccountRowActions, Balance, SystemBadge } from "../shared";

type Group = GroupChoice;
type SubGroup = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  isActive: boolean;
  parentAccountId: string | null;
  tdsHeadKey: string | null;
  /** This account's own balance (its group's total includes it). */
  own: number;
  system: boolean;
};

export function SubGroupsTable({ groups, subGroups, groupById }: { groups: Group[]; subGroups: SubGroup[]; groupById: Record<string, Group> }) {
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { report, dialog } = useProblem();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <AddAccountDialog label="Add sub-group" startInside groups={groups} />
      </div>

      {dialog}

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
                <AccountRowActions account={{ ...sg, parentTdsHeadKey: sg.parentAccountId ? groupById[sg.parentAccountId]?.tdsHeadKey ?? null : null }} showSubCategory={false} onError={(message) => report(message)} />
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
