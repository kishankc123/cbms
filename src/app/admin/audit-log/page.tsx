import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { listPlatformAudit, PLATFORM_AUDIT_KINDS, type PlatformAuditKind } from "@/lib/platform-audit";
import { AdminHeader, adminCard, when } from "../ui";

export default async function AdminAuditLogPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requirePlatformAdmin();
  const { kind: raw } = await searchParams;
  const kind = (PLATFORM_AUDIT_KINDS.find((k) => k.key === raw)?.key ?? "all") as PlatformAuditKind;
  const rows = await listPlatformAudit(kind);
  return (
    <div className="space-y-5">
      <AdminHeader title="Platform Audit Log" description="Everything that belongs to no single organization: who signed in (and who failed to), and what platform administrators changed: tax rates, requirement templates, fines and penalties, suspensions. The latest 300 events." />
      <div className="flex flex-wrap gap-2">
        {PLATFORM_AUDIT_KINDS.map((k) => (
          <Link key={k.key} href={`/admin/audit-log${k.key === "all" ? "" : `?kind=${k.key}`}`} className={`rounded-full border px-3 py-1 text-sm ${kind === k.key ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--card-border)] text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]"}`}>
            {k.label}
          </Link>
        ))}
      </div>
      <div className={`${adminCard} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">Event</th>
              <th className="px-4 py-2 font-medium">Before</th>
              <th className="px-4 py-2 font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--card-border)] align-top">
                <td className="whitespace-nowrap px-4 py-2 text-[var(--text-secondary)]">{when(r.at)}</td>
                <td className="px-4 py-2">{r.who}</td>
                <td className="px-4 py-2">
                  <p className="text-[var(--text-primary)]">{r.what}</p>
                  <p className="font-mono text-xs text-[var(--text-secondary)]">{r.action}</p>
                </td>
                <td className="max-w-xs break-words px-4 py-2 text-xs text-[var(--text-secondary)]">{r.before ?? "—"}</td>
                <td className="max-w-xs break-words px-4 py-2 text-xs text-[var(--text-secondary)]">{r.after ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-secondary)]">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
