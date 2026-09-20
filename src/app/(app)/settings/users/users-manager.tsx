"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteUser, revokeInvitation, changeMemberRole, setMemberStatus, removeMember, type listMembers } from "./actions";
import { ORG_ROLES, roleLabel, type OrgRole } from "@/lib/roles";
import { StatusPill } from "@/components/ui/status-pill";

type Data = Awaited<ReturnType<typeof listMembers>>;
const selCls = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm";

export function UsersManager({ data }: { data: Data }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("accountant");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; link?: string } | null>(null);

  // Owners can hand out any role; administrators can't create or touch Owners.
  const assignable = ORG_ROLES.filter((r) => r.value !== "owner" || data.myRole === "owner");

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Action failed" });
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await inviteUser({ email, role });
    setBusy(false);
    if (!r.ok) return setMessage({ tone: "error", text: r.error });
    setMessage({ tone: "ok", text: `Invitation sent to ${email}.`, link: r.devLink });
    setEmail("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={invite} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Invite User</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${selCls} w-72`} placeholder="accountant@example.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className={selCls}>
              {assignable.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busy} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50">
            {busy ? "Sending..." : "Send Invitation"}
          </button>
        </div>
        <p className="text-xs text-gray-500">{ORG_ROLES.find((r) => r.value === role)?.description}. If they already have an account they keep their existing email and password.</p>
        {message && (
          <div className={`text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>
            <p>{message.text}</p>
            {message.link && (
              <p className="mt-1 break-all text-xs text-gray-600">
                Email service not configured (dev only) — invitation link: <a href={message.link} className="text-[var(--color-primary)] underline">{message.link}</a>
              </p>
            )}
          </div>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold">Name</th>
              <th className="px-3 py-2 text-xs font-semibold">Email</th>
              <th className="px-3 py-2 text-xs font-semibold">Role</th>
              <th className="px-3 py-2 text-xs font-semibold">Status</th>
              <th className="px-3 py-2 text-xs font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => {
              const isMe = m.userId === data.me;
              const locked = isMe || (m.role === "owner" && data.myRole !== "owner");
              return (
                <tr key={m.userId} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    {m.name} {isMe && <span className="text-xs text-gray-400">(you)</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{m.email}</td>
                  <td className="px-3 py-2">
                    {locked ? (
                      roleLabel(m.role)
                    ) : (
                      <select value={m.role} onChange={(e) => run(() => changeMemberRole(m.userId, e.target.value as OrgRole))} className={selCls}>
                        {assignable.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={m.status === "active" ? "success" : "action"}>{m.status}</StatusPill>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!locked && (
                      <>
                        <button type="button" onClick={() => run(() => setMemberStatus(m.userId, m.status === "active" ? "suspended" : "active"))} className="text-xs text-gray-600 hover:underline mr-3">
                          {m.status === "active" ? "Suspend" : "Reactivate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Remove ${m.name} from this organization?`)) run(() => removeMember(m.userId));
                          }}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.pending.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Pending invitations</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {data.pending.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 first:border-t-0">
                    <td className="px-3 py-2">{p.email}</td>
                    <td className="px-3 py-2 text-gray-600">{roleLabel(p.role)}</td>
                    <td className="px-3 py-2">{p.expired ? <StatusPill tone="critical">expired</StatusPill> : <StatusPill tone="pending">pending</StatusPill>}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => run(() => revokeInvitation(p.id))} className="text-xs text-red-600 hover:underline">
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
