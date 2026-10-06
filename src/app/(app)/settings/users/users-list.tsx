"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { removeMember, setMemberStatus, type UsersPage } from "./actions";

type Row = UsersPage["list"]["rows"][number];
const field = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none";

export function UsersList({ data, filters }: { data: UsersPage; filters: { q: string; status: string; role: string } }) {
  const router = useRouter();
  const { reportError, dialog } = useProblem();
  const [q, setQ] = useState(filters.q);
  const [menu, setMenu] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const { list } = data;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  function go(next: Partial<{ q: string; status: string; role: string; page: number }>) {
    const merged = { q: filters.q, status: filters.status, role: filters.role, page: 1, ...next };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.status) params.set("status", merged.status);
    if (merged.role) params.set("role", merged.role);
    if (merged.page > 1) params.set("page", String(merged.page));
    if (list.pageSize !== 25) params.set("size", String(list.pageSize));
    router.push(`/settings/users${params.size ? `?${params}` : ""}`);
  }

  async function run(fn: () => Promise<unknown>) {
    setMenu(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  const locked = (r: Row) => r.userId === data.me || (r.baseRole === "owner" && data.myRole !== "owner");

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({ q });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or ID" className={`${field} w-64`} />
        <select value={filters.role} onChange={(e) => go({ role: e.target.value })} className={field}>
          <option value="">All roles</option>
          {data.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => go({ status: e.target.value })} className={field}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Search
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.userId} className="border-t border-[var(--card-border)]">
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.code}</td>
                <td className="px-4 py-2 font-medium">
                  <Link href={`/settings/users/${r.userId}`} className="text-[var(--color-primary)] hover:underline">
                    {r.name}
                  </Link>{" "}
                  {r.userId === data.me && <span className="text-xs font-normal text-gray-400">(you)</span>}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  {r.email}
                  {!r.verified && <span className="ml-2 text-xs text-amber-700">unverified</span>}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.mobile || "—"}</td>
                <td className="px-4 py-2">{r.roleName}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={r.status === "active" ? "success" : "action"}>{r.status === "active" ? "Active" : "Suspended"}</StatusPill>
                </td>
                <td className="relative px-2">
                  <button type="button" aria-label="Actions" onClick={() => setMenu(menu === r.userId ? null : r.userId)} className="rounded px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
                    ⋮
                  </button>
                  {menu === r.userId && (
                    <div className="absolute right-2 top-9 z-10 w-40 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] py-1 text-sm shadow-lg">
                      <Link href={`/settings/users/${r.userId}`} className="block px-3 py-1.5 hover:bg-[var(--surface-muted-bg)]">
                        {locked(r) ? "View" : "Edit"}
                      </Link>
                      {!locked(r) && (
                        <>
                          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[var(--surface-muted-bg)]" onClick={() => run(() => setMemberStatus(r.userId, r.status === "active" ? "suspended" : "active"))}>
                            {r.status === "active" ? "Suspend" : "Reactivate"}
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-[var(--surface-muted-bg)]"
                            onClick={() => {
                              setMenu(null);
                              setRemoving(r);
                            }}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {list.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
        <span>
          {list.total} user{list.total === 1 ? "" : "s"}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-3">
            <button type="button" disabled={list.page <= 1} onClick={() => go({ page: list.page - 1 })} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">
              Previous
            </button>
            <span>
              Page {list.page} of {pages}
            </span>
            <button type="button" disabled={list.page >= pages} onClick={() => go({ page: list.page + 1 })} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">
              Next
            </button>
          </span>
        )}
      </div>

      {removing && (
        <ConfirmDialog
          message={`Remove ${removing.name} from this organization? They keep their account and any other organizations.`}
          onYes={() => {
            const r = removing;
            setRemoving(null);
            run(() => removeMember(r.userId));
          }}
          onNo={() => setRemoving(null)}
        />
      )}
      {dialog}
    </div>
  );
}
