"use client";

import { useState } from "react";
import Link from "next/link";
import { useProblem } from "@/components/problem-dialog";
import type { AccountLookup } from "@/lib/org-members";
import { addUser, findAccount, inviteUser, type AddUserData } from "../actions";
import { settingsButton, settingsInput, settingsLabel } from "../../ui";

type Done = { text: string; link?: string };

export function AddUserForm({ data }: { data: AddUserData }) {
  const { report, reportError, dialog } = useProblem();
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState<{ email: string; result: AccountLookup } | null>(null);
  const [roleId, setRoleId] = useState(() => data.roles.find((r) => r.name === "Accountant")?.id ?? data.roles[0]?.id ?? "");
  const [status, setStatus] = useState<"active" | "suspended">("active");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const role = data.roles.find((r) => r.id === roleId);
  const result = checked && checked.email === email.trim().toLowerCase() ? checked.result : null;

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setDone(null);
    setBusy(true);
    try {
      const r = await findAccount(email);
      setChecked({ email: email.trim().toLowerCase(), result: r });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    try {
      const r = await addUser({ email, roleId, status });
      if (!r.ok) return report(r.error, '[data-field="role"]');
      setDone({ text: `${r.name} was added as ${role?.name}. They'll see a notice and get an email.` });
      setChecked(null);
      setEmail("");
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    setBusy(true);
    try {
      const r = await inviteUser({ email, roleId });
      if (!r.ok) return report(r.error, '[data-field="role"]');
      setDone({ text: `Invitation sent to ${email.trim()}.`, link: r.devLink });
      setChecked(null);
      setEmail("");
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  const roleStatus = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className={settingsLabel}>Role *</label>
        <select data-field="role" className={settingsInput} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {data.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {role?.description && <p className="mt-1 text-xs text-gray-500">{role.description}</p>}
      </div>
      <div>
        <label className={settingsLabel}>Status</label>
        <select className={settingsInput} value={status} onChange={(e) => setStatus(e.target.value as "active" | "suspended")}>
          <option value="active">Active</option>
          <option value="suspended">Suspended (no access yet)</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className="max-w-lg space-y-4">
      {done && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p>{done.text}</p>
          {done.link && (
            <p className="mt-1 break-all text-xs text-gray-600">
              Email service not configured (dev only) — invitation link:{" "}
              <a href={done.link} className="text-[var(--color-primary)] underline">
                {done.link}
              </a>
            </p>
          )}
          <p className="mt-1">
            <Link href="/settings/users" className="font-medium underline">
              Back to the user list
            </Link>
          </p>
        </div>
      )}

      <form onSubmit={find} className="space-y-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <div>
          <label className={settingsLabel}>Email address *</label>
          <div className="flex gap-2">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={settingsInput} placeholder="person@example.com" autoComplete="off" />
            <button type="submit" disabled={busy || !email.trim()} className="whitespace-nowrap rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Find account
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">People create their own login (name, password, contact number) with &ldquo;Create a user account&rdquo; on the sign-in page. You only choose their role and status here.</p>
        </div>

        {result?.state === "invalid" && <p className="text-sm text-red-600">Enter a valid email address.</p>}
        {result?.state === "member" && (
          <p className="rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            {result.name} is already in your organization as {result.roleName}. Change their role from the{" "}
            <Link href="/settings/users" className="text-[var(--color-primary)] underline">
              user list
            </Link>
            .
          </p>
        )}
      </form>

      {result?.state === "found" && (
        <div className="space-y-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
          <p className="text-sm text-[var(--text-primary)]">
            <span className="font-medium">{result.name}</span> has an account. They sign in with their existing email and password, so no password is needed.
          </p>
          {roleStatus}
          <button type="button" onClick={add} disabled={busy || !roleId} className={`${settingsButton} disabled:opacity-50`}>
            {busy ? "Adding..." : "Add user"}
          </button>
          <p className="text-xs text-gray-500">They get access straight away, and see a notice the next time they sign in (and an email) so they can leave if it isn&apos;t expected.</p>
        </div>
      )}

      {result?.state === "none" && (
        <div className="space-y-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
          <p className="text-sm text-[var(--text-primary)]">No verified account was found for this email.</p>
          <p className="text-sm text-[var(--text-secondary)]">Ask them to create a user account and verify their email, then find them here. Or send an invitation now: the link in the email lets them create their account and join with the role below.</p>
          <div className="max-w-xs">
            <label className={settingsLabel}>Role *</label>
            <select data-field="role" className={settingsInput} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {data.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={invite} disabled={busy || !roleId} className={`${settingsButton} disabled:opacity-50`}>
            {busy ? "Sending..." : "Send invitation"}
          </button>
        </div>
      )}
      {dialog}
    </div>
  );
}
