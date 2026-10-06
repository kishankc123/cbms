"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { adminCard, adminField, when } from "../ui";
import type { getAdminOrgs } from "../actions";

type Data = Awaited<ReturnType<typeof getAdminOrgs>>;
export const orgTone = (s: string) => (s === "active" ? "success" : s === "suspended" ? "action" : "critical");

export function OrgsTable({ data, filters }: { data: Data; filters: { q: string; status: string } }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  function go(next: Partial<{ q: string; status: string; page: number }>) {
    const m = { ...filters, page: 1, ...next };
    const params = new URLSearchParams();
    if (m.q) params.set("q", m.q);
    if (m.status) params.set("status", m.status);
    if (m.page > 1) params.set("page", String(m.page));
    router.push(`/admin/organizations${params.size ? `?${params}` : ""}`);
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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, client code or PAN" className={`${adminField} w-72`} />
        <select value={filters.status} onChange={(e) => go({ status: e.target.value })} className={adminField}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Search
        </button>
      </form>

      <div className={`${adminCard} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Client code</th>
              <th className="px-4 py-2 font-medium">Organization</th>
              <th className="px-4 py-2 font-medium">PAN / VAT</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 text-right font-medium">Members</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((o) => (
              <tr key={o.id} className="border-t border-[var(--card-border)]">
                <td className="px-4 py-2 text-[var(--text-secondary)]">{o.clientCode ?? "—"}</td>
                <td className="px-4 py-2 font-medium">
                  <Link href={`/admin/organizations/${o.id}`} className="text-[var(--color-primary)] hover:underline">
                    {o.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{o.pan ?? "—"}</td>
                <td className="px-4 py-2">{o.owner ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{o.members}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  {o.plan ?? "—"}
                  {o.planStatus ? ` (${o.planStatus.replace("_", " ")})` : ""}
                </td>
                <td className="px-4 py-2">
                  <StatusPill tone={orgTone(o.status)}>{o.status === "active" ? "Active" : o.status === "suspended" ? "Suspended" : "Cancelled"}</StatusPill>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{when(o.createdAt)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  No organizations match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
        <span>
          {data.total} organization{data.total === 1 ? "" : "s"}
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
