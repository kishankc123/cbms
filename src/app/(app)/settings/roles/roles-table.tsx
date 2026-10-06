"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { removeRole, type RolesList } from "./actions";

export function RolesTable({ roles }: { roles: RolesList }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [menu, setMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RolesList[number] | null>(null);

  async function confirmDelete() {
    const role = deleting;
    setDeleting(null);
    if (!role) return;
    try {
      const r = await removeRole(role.id);
      if (!r.ok) return report(r.error);
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
          <tr>
            <th className="px-4 py-2 font-medium">ID</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Description</th>
            <th className="px-4 py-2 font-medium">Access</th>
            <th className="px-4 py-2 text-right font-medium">Users</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id} className="border-t border-[var(--card-border)]">
              <td className="px-4 py-2 text-[var(--text-secondary)]">{r.code}</td>
              <td className="px-4 py-2 font-medium">
                <Link href={`/settings/roles/${r.id}`} className="text-[var(--color-primary)] hover:underline">
                  {r.name}
                </Link>{" "}
                {r.isSystem && <span className="ml-1 rounded-full border border-[var(--card-border)] px-2 py-0.5 text-xs font-normal text-[var(--text-secondary)]">System</span>}
              </td>
              <td className="max-w-xs px-4 py-2 text-[var(--text-secondary)]">{r.description || "—"}</td>
              <td className="px-4 py-2">{r.access}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.members}</td>
              <td className="px-4 py-2">
                <StatusPill tone={r.isActive ? "success" : "pending"}>{r.isActive ? "Active" : "Inactive"}</StatusPill>
              </td>
              <td className="relative px-2">
                <button type="button" aria-label="Actions" onClick={() => setMenu(menu === r.id ? null : r.id)} className="rounded px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
                  ⋮
                </button>
                {menu === r.id && (
                  <div className="absolute right-2 top-9 z-10 w-40 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] py-1 text-sm shadow-lg">
                    <Link href={`/settings/roles/${r.id}`} className="block px-3 py-1.5 hover:bg-[var(--surface-muted-bg)]">
                      {r.fixed ? "View" : "Edit"}
                    </Link>
                    <Link href={`/settings/roles/new?copy=${r.id}`} className="block px-3 py-1.5 hover:bg-[var(--surface-muted-bg)]">
                      Duplicate
                    </Link>
                    {!r.isSystem && (
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-[var(--surface-muted-bg)]"
                        onClick={() => {
                          setMenu(null);
                          setDeleting(r);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {deleting && <ConfirmDialog message={`Delete the role "${deleting.name}"?`} onYes={confirmDelete} onNo={() => setDeleting(null)} />}
      {dialog}
    </div>
  );
}
