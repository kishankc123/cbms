"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/app/(app)/sales/confirm-dialog";
import { changePlatformAdmin, changeUserStatus, signUserOut, unlockAccount, type AdminUser } from "../../actions";
import { Facts, adminCard, when } from "../../ui";

type Pending = { message: string; run: () => Promise<{ ok: true } | { ok: false; error: string }> };
const btn = "rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50";

export function UserDetail({ data }: { data: AdminUser }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [pending, setPending] = useState<Pending | null>(null);
  const u = data.user;

  async function confirmed() {
    const p = pending;
    setPending(null);
    if (!p) return;
    try {
      const r = await p.run();
      if (!r.ok) return report(r.error);
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  const ask = (message: string, run: Pending["run"]) => () => setPending({ message, run });

  return (
    <div className="space-y-4">
      <section className={`${adminCard} space-y-4 p-5`}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={u.status === "active" ? "success" : "critical"}>{u.status === "active" ? "Active" : u.status === "disabled" ? "Disabled" : "Invited"}</StatusPill>
          {u.locked && <StatusPill tone="critical">Locked until {when(u.lockedUntil)}</StatusPill>}
          {u.isPlatformAdmin && <StatusPill tone="action">Platform administrator</StatusPill>}
          {!u.verified && <StatusPill tone="pending">Email not verified</StatusPill>}
        </div>
        <Facts
          items={[
            ["Name", u.name],
            ["Email", u.email],
            ["Contact number", u.mobile],
            ["Registered", when(u.createdAt)],
            ["Last sign-in", when(u.lastLogin)],
            ["Failed sign-ins in a row", String(u.failedLoginCount)],
          ]}
        />
      </section>

      <section className={`${adminCard} space-y-3 p-5`}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Account controls</h2>
        {data.isMe && <p className="text-sm text-[var(--text-secondary)]">This is your own account, so disabling it or removing your administrator access isn&apos;t offered.</p>}
        <div className="flex flex-wrap gap-2">
          {u.locked && (
            <button type="button" className={btn} onClick={ask(`Unlock ${u.email}? They can try signing in again straight away.`, () => unlockAccount(u.id))}>
              Unlock
            </button>
          )}
          <button type="button" className={btn} onClick={ask(`Sign ${u.email} out of every session? They'll have to sign in again.`, () => signUserOut(u.id))}>
            Force sign-out
          </button>
          {!data.isMe &&
            (u.status === "disabled" ? (
              <button type="button" className={btn} onClick={ask(`Enable ${u.email}? They will be able to sign in again.`, () => changeUserStatus(u.id, "active"))}>
                Enable account
              </button>
            ) : (
              <button type="button" className={`${btn} text-red-600`} onClick={ask(`Disable ${u.email}? They are signed out everywhere now and can't sign in to any organization until you enable the account.`, () => changeUserStatus(u.id, "disabled"))}>
                Disable account
              </button>
            ))}
          {u.isPlatformAdmin
            ? !data.isMe && (
                <button type="button" className={btn} onClick={ask(`Remove platform administrator access from ${u.email}? They are signed out now.`, () => changePlatformAdmin(u.id, false))}>
                  Remove platform admin
                </button>
              )
            : (
                <button type="button" className={btn} onClick={ask(`Make ${u.email} a platform administrator? They will see every organization and user on the platform from their next sign-in.`, () => changePlatformAdmin(u.id, true))}>
                  Make platform admin
                </button>
              )}
        </div>
        <p className="text-xs text-[var(--text-secondary)]">Every change here is recorded in the platform audit trail with who made it.</p>
      </section>

      <section className={`${adminCard} overflow-x-auto`}>
        <h2 className="px-5 py-3 text-sm font-semibold text-[var(--text-primary)]">Organizations ({data.organizations.length})</h2>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Organization</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Their access</th>
              <th className="px-4 py-2 font-medium">Organization</th>
              <th className="px-4 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.organizations.map((o) => (
              <tr key={o.tenantId} className="border-t border-[var(--card-border)]">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/admin/organizations/${o.tenantId}`} className="text-[var(--color-primary)] hover:underline">
                    {o.name}
                  </Link>{" "}
                  <span className="text-xs font-normal text-[var(--text-secondary)]">{o.clientCode}</span>
                </td>
                <td className="px-4 py-2">{o.roleName}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={o.status === "active" ? "success" : "action"}>{o.status === "active" ? "Active" : "Suspended"}</StatusPill>
                </td>
                <td className="px-4 py-2">
                  <StatusPill tone={o.orgStatus === "active" ? "success" : "critical"}>{o.orgStatus === "active" ? "Active" : o.orgStatus === "suspended" ? "Suspended" : "Cancelled"}</StatusPill>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{when(o.joined)}</td>
              </tr>
            ))}
            {data.organizations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-secondary)]">
                  Not part of any organization.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className={`${adminCard} p-5`}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Recent activity</h2>
        {data.events.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{e.action.replace(/_/g, " ")}</span>
                <span className="text-[var(--text-secondary)]">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && <ConfirmDialog message={pending.message} onYes={confirmed} onNo={() => setPending(null)} />}
      {dialog}
    </div>
  );
}
