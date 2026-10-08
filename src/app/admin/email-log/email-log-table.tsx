"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { EMAIL_KIND_LABEL } from "@/lib/email-log-labels";
import { adminCard, adminField, when } from "../ui";

type Row = { id: string; toEmail: string; kind: string; subject: string; status: string; error: string | null; providerId: string | null; createdAt: string; organization: string | null };
type Data = { rows: Row[]; total: number; page: number; pageSize: number };

const TONE: Record<string, { tone: StatusTone; label: string }> = {
  sent: { tone: "success", label: "Sent" },
  failed: { tone: "critical", label: "Failed" },
  not_configured: { tone: "pending", label: "Not sent: no email service" },
};

export function EmailLogTable({ data, day, configured, filters }: { data: Data; day: { sent: number; failed: number; notConfigured: number }; configured: boolean; filters: { status: string; kind: string; q: string } }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  function go(next: Partial<{ status: string; kind: string; q: string; page: number }>) {
    const m = { ...filters, page: 1, ...next };
    const params = new URLSearchParams();
    if (m.status) params.set("status", m.status);
    if (m.kind) params.set("kind", m.kind);
    if (m.q) params.set("q", m.q);
    if (m.page > 1) params.set("page", String(m.page));
    router.push(`/admin/email-log${params.size ? `?${params}` : ""}`);
  }

  return (
    <div className="space-y-4">
      {!configured && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No email service is set up on this server (RESEND_API_KEY is missing), so messages are only printed in the server log and never delivered. Set RESEND_API_KEY, EMAIL_FROM and APP_URL.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${adminCard} p-4`}>
          <p className="text-xs text-[var(--text-secondary)]">Sent, last 24 hours</p>
          <p className="text-2xl font-semibold tabular-nums">{day.sent}</p>
        </div>
        <div className={`${adminCard} p-4`}>
          <p className="text-xs text-[var(--text-secondary)]">Failed, last 24 hours</p>
          <p className={`text-2xl font-semibold tabular-nums ${day.failed > 0 ? "text-[var(--status-critical-text)]" : ""}`}>{day.failed}</p>
        </div>
        <div className={`${adminCard} p-4`}>
          <p className="text-xs text-[var(--text-secondary)]">Not sent (no service), last 24 hours</p>
          <p className="text-2xl font-semibold tabular-nums">{day.notConfigured}</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({ q });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address or subject" className={`${adminField} w-72`} />
        <select value={filters.status} onChange={(e) => go({ status: e.target.value })} className={adminField}>
          <option value="">Any outcome</option>
          <option value="failed">Failed</option>
          <option value="sent">Sent</option>
          <option value="not_configured">Not sent: no email service</option>
        </select>
        <select value={filters.kind} onChange={(e) => go({ kind: e.target.value })} className={adminField}>
          <option value="">Any kind</option>
          {Object.entries(EMAIL_KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-sm text-[var(--text-secondary)]">{data.total} email{data.total === 1 ? "" : "s"}</span>
      </form>

      <div className={`${adminCard} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">To</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">Organization</th>
              <th className="px-4 py-2 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--card-border)] align-top">
                <td className="whitespace-nowrap px-4 py-2 text-[var(--text-secondary)]">{when(r.createdAt)}</td>
                <td className="px-4 py-2">
                  {r.toEmail}
                  <br />
                  <span className="text-xs text-[var(--text-secondary)]">{r.subject}</span>
                </td>
                <td className="px-4 py-2">{EMAIL_KIND_LABEL[r.kind] ?? r.kind}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.organization ?? "—"}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={TONE[r.status]?.tone ?? "pending"}>{TONE[r.status]?.label ?? r.status}</StatusPill>
                  {r.error && r.status !== "sent" && <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">{r.error}</p>}
                  {r.providerId && <p className="mt-1 text-xs text-[var(--text-secondary)]">Provider id: {r.providerId}</p>}
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-secondary)]">
                  No emails match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" disabled={data.page <= 1} onClick={() => go({ page: data.page - 1 })} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50">
            Previous
          </button>
          <span className="text-[var(--text-secondary)]">
            Page {data.page} of {pages}
          </span>
          <button type="button" disabled={data.page >= pages} onClick={() => go({ page: data.page + 1 })} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
