"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { ConfirmDialog } from "../../../sales/confirm-dialog";
import { changeMemberRole, removeMember, setMemberStatus, type MemberForEdit } from "../actions";
import { settingsButton, settingsInput, settingsLabel } from "../../ui";

export function EditUserForm({ data }: { data: MemberForEdit }) {
  const router = useRouter();
  const { reportError, dialog } = useProblem();
  const m = data.member;
  const [roleId, setRoleId] = useState(m.roleId ?? "");
  const [status, setStatus] = useState<"active" | "suspended">(m.status);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      if (roleId && roleId !== m.roleId) await changeMemberRole(m.userId, roleId);
      if (status !== m.status) await setMemberStatus(m.userId, status);
      setSaved(true);
      router.refresh();
    } catch (e) {
      reportError(e, [[/role/i, '[data-field="role"]']]);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setConfirmRemove(false);
    try {
      await removeMember(m.userId);
      router.push("/settings/users");
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  const read = (label: string, value: string) => (
    <div>
      <label className={settingsLabel}>{label}</label>
      <input className={`${settingsInput} bg-gray-50`} value={value} readOnly tabIndex={-1} />
    </div>
  );

  return (
    <div className="max-w-2xl space-y-4">
      <section className="space-y-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Account</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {read("ID", m.code)}
          {read("Name", m.name)}
          {read("Email", m.verified ? m.email : `${m.email} (not verified)`)}
          {read("Contact number", m.mobile || "—")}
        </div>
        <p className="text-xs text-gray-500">The person owns these details and changes them themselves. You control their role and status in this organization.</p>
      </section>

      <section className="space-y-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Access in this organization</h2>
        {data.locked && <p className="rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">{data.isMe ? "You can't change your own access." : "Only an Owner can change an Owner."}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={settingsLabel}>Role</label>
            <select data-field="role" className={settingsInput} value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={data.locked}>
              {data.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={settingsLabel}>Status</label>
            <select className={settingsInput} value={status} onChange={(e) => setStatus(e.target.value as "active" | "suspended")} disabled={data.locked}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!data.locked && (
            <button type="button" onClick={save} disabled={saving} className={`${settingsButton} disabled:opacity-50`}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          )}
          <Link href="/settings/users" className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            {data.locked ? "Back" : "Cancel"}
          </Link>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
          {!data.locked && (
            <button type="button" onClick={() => setConfirmRemove(true)} className="ml-auto text-sm text-red-600 hover:underline">
              Remove from organization
            </button>
          )}
        </div>
      </section>

      {confirmRemove && <ConfirmDialog message={`Remove ${m.name} from this organization? They keep their account and any other organizations.`} onYes={remove} onNo={() => setConfirmRemove(false)} />}
      {dialog}
    </div>
  );
}
