"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/app/(app)/sales/confirm-dialog";
import { changeOrgStatus, type AdminOrg } from "../../actions";
import { Facts, adminCard, adminField, when } from "../../ui";
import { orgTone } from "../orgs-table";

export function OrgDetail({ data }: { data: AdminOrg }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<"suspended" | "active" | null>(null);
  const o = data.org;

  async function apply() {
    const status = confirm;
    setConfirm(null);
    if (!status) return;
    try {
      const r = await changeOrgStatus(o.id, status, reason);
      if (!r.ok) return report(r.error, '[data-field="reason"]');
      setReason("");
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="space-y-4">
      <section className={`${adminCard} space-y-4 p-5`}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={orgTone(o.status)}>{o.status === "active" ? "Active" : o.status === "suspended" ? "Suspended" : "Cancelled"}</StatusPill>
        </div>
        <Facts
          items={[
            ["Organization", o.name],
            ["Client code", o.clientCode],
            ["PAN / VAT number", o.pan],
            ["Industry", o.industry],
            ["Country", o.country],
            ["Address", o.address],
            ["Phone", o.phone],
            ["Business email", o.email],
            ["Calendar", o.calendar === "BS" ? "BS — Bikram Sambat" : "AD — Gregorian"],
            ["Created", when(o.createdAt)],
            ["Plan", o.plan ? `${o.plan}${o.planStatus ? ` (${o.planStatus.replace("_", " ")})` : ""}` : null],
            ["Trial ends", o.trialEndsAt ? when(o.trialEndsAt) : null],
          ]}
        />
      </section>

      <section className={`${adminCard} space-y-3 p-5`}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{o.status === "suspended" ? "Reactivate" : "Suspend"}</h2>
        {o.status === "cancelled" ? (
          <p className="text-sm text-[var(--text-secondary)]">A cancelled organization can&apos;t be changed here.</p>
        ) : o.status === "suspended" ? (
          <>
            <p className="text-sm text-[var(--text-secondary)]">Members can&apos;t open this organization while it is suspended. Reactivating restores access on their next request.</p>
            <button type="button" onClick={() => setConfirm("active")} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
              Reactivate organization
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text-secondary)]">Suspending blocks every member of this organization at once, on their next request. Their data is untouched, and each member keeps their account and any other organizations.</p>
            <div className="max-w-md">
              <label className="mb-1 block text-xs text-gray-500">Reason *</label>
              <input data-field="reason" className={`${adminField} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Unpaid subscription" />
            </div>
            <button type="button" onClick={() => setConfirm("suspended")} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-700 hover:bg-red-50">
              Suspend organization
            </button>
          </>
        )}
      </section>

      <section className={`${adminCard} overflow-x-auto`}>
        <h2 className="px-5 py-3 text-sm font-semibold text-[var(--text-primary)]">Members ({data.members.length})</h2>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId} className="border-t border-[var(--card-border)]">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/admin/users/${m.userId}`} className="text-[var(--color-primary)] hover:underline">
                    {m.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{m.email}</td>
                <td className="px-4 py-2">{m.roleName}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={m.status === "active" ? "success" : "action"}>{m.status === "active" ? "Active" : "Suspended"}</StatusPill>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{when(m.joined)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${adminCard} p-5`}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Platform history</h2>
        {data.events.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>
                  {e.action.replace(/_/g, " ")}
                  {e.reason ? ` — ${e.reason}` : ""}
                </span>
                <span className="text-[var(--text-secondary)]">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirm && <ConfirmDialog message={confirm === "suspended" ? `Suspend ${o.name}? All ${data.members.length} member(s) are blocked from it now.` : `Reactivate ${o.name}?`} onYes={apply} onNo={() => setConfirm(null)} />}
      {dialog}
    </div>
  );
}
