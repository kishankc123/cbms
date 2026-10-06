"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { adminField, adminCard, when } from "../ui";
import type { getAdminUsers } from "../actions";

type Data = Awaited<ReturnType<typeof getAdminUsers>>;

export function UsersTable({ data, filters }: { data: Data; filters: { q: string; status: string; admins: boolean } }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  function go(next: Partial<{ q: string; status: string; admins: boolean; page: number }>) {
    const m = { ...filters, page: 1, ...next };
    const params = new URLSearchParams();
    if (m.q) params.set("q", m.q);
    if (m.status) params.set("status", m.status);
    if (m.admins) params.set("admins", "1");
    if (m.page > 1) params.set("page", String(m.page));
    router.push(`/admin/users${params.size ? `?${params}` : ""}`);
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({ q });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or contact" className={`${adminField} w-72`} />
        <select value={filters.status} onChange={(e) => go({ status: e.target.value })} className={adminField}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={filters.admins} onChange={(e) => go({ admins: e.target.checked })} />
          Platform administrators only
        </label>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Search
        </button>
      </form>

      <div className={`${adminCard} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 text-right font-medium">Organizations</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Last sign-in</th>
              <th className="px-4 py-2 font-medium">Registered</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((u) => (
              <tr key={u.id} className="border-t border-[var(--card-border)]">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/admin/users/${u.id}`} className="text-[var(--color-primary)] hover:underline">
                    {u.name}
                  </Link>
                  {u.isPlatformAdmin && <span className="ml-2 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-normal text-red-700">Platform admin</span>}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  {u.email}
                  {!u.verified && <span className="ml-2 text-xs text-amber-700">unverified</span>}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{u.mobile || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{u.organizations}</td>
                <td className="px-4 py-2">
                  {u.locked ? <StatusPill tone="critical">Locked</StatusPill> : <StatusPill tone={u.status === "active" ? "success" : "critical"}>{u.status === "active" ? "Active" : u.status === "disabled" ? "Disabled" : "Invited"}</StatusPill>}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{when(u.lastLogin)}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{when(u.createdAt)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
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
          {data.total} user{data.total === 1 ? "" : "s"}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-3">
            <button type="button" disabled={data.page <= 1} onClick={() => go({ page: data.page - 1 })} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">
              Previous
            </button>
            <span>
              Page {data.page} of {pages}
            </span>
            <button type="button" disabled={data.page >= pages} onClick={() => go({ page: data.page + 1 })} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">
              Next
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
