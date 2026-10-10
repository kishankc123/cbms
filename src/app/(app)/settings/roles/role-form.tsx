"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem, type FieldRules } from "@/components/problem-dialog";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { ACTION_LABEL, PERMISSION_ACTIONS, type ExtraPermission, type Permissions, type PermissionAction } from "@/lib/permissions";
import { removeRole, resetRole, saveRole, type RoleEditor } from "./actions";
import { settingsButton, settingsInput, settingsLabel } from "../ui";

const SERVER_RULES: FieldRules = [
  [/role name|already exists|named/i, '[data-field="name"]'],
  [/permission/i, '[data-field="matrix"]'],
];

export function RoleForm({ editor }: { editor: RoleEditor }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const role = editor.role;
  const readOnly = Boolean(role?.fixed);
  const [name, setName] = useState(editor.initial.name);
  const [description, setDescription] = useState(editor.initial.description);
  const [isActive, setIsActive] = useState(role?.isActive ?? true);
  const [perms, setPerms] = useState<Permissions>(editor.initial.permissions);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);

  const has = (m: string, a: PermissionAction | ExtraPermission) => Boolean(perms[m]?.[a]);

  function set(module: string, action: PermissionAction, on: boolean) {
    setPerms((prev) => {
      const def = editor.catalog.find((m) => m.key === module)!;
      const row = { ...(prev[module] ?? {}) };
      row[action] = on;
      // Any action needs View, and taking View away takes everything else with it.
      if (on && action !== "view" && def.actions.includes("view")) row.view = true;
      if (!on && action === "view") {
        for (const a of def.actions) row[a] = false;
        for (const e of def.extras ?? []) row[e.key] = false;
      }
      return { ...prev, [module]: row };
    });
  }

  // A special permission (such as seeing salary amounts) needs View, like any other action.
  function setExtra(module: string, key: ExtraPermission, on: boolean) {
    setPerms((prev) => {
      const row = { ...(prev[module] ?? {}) };
      row[key] = on;
      if (on) row.view = true;
      return { ...prev, [module]: row };
    });
  }

  function setRow(module: string, on: boolean) {
    const def = editor.catalog.find((m) => m.key === module)!;
    setPerms((prev) => ({ ...prev, [module]: Object.fromEntries([...def.actions, ...(def.extras ?? []).map((e) => e.key)].map((a) => [a, on])) }));
  }

  function setColumn(action: PermissionAction, on: boolean) {
    setPerms((prev) => {
      const next: Permissions = { ...prev };
      for (const m of editor.catalog) {
        if (!m.actions.includes(action)) continue;
        const row = { ...(next[m.key] ?? {}) };
        row[action] = on;
        if (on && action !== "view") row.view = true;
        if (!on && action === "view") {
          for (const a of m.actions) row[a] = false;
          for (const e of m.extras ?? []) row[e.key] = false;
        }
        next[m.key] = row;
      }
      return next;
    });
  }

  const rowAll = (m: (typeof editor.catalog)[number]) => m.actions.every((a) => has(m.key, a)) && (m.extras ?? []).every((e) => has(m.key, e.key));
  const colAll = (a: PermissionAction) => editor.catalog.filter((m) => m.actions.includes(a)).every((m) => has(m.key, a));

  async function save() {
    setSaving(true);
    try {
      const r = await saveRole(role?.id ?? null, { name, description, permissions: perms, isActive });
      if (!r.ok) return report(r.error, SERVER_RULES.find(([re]) => re.test(r.error))?.[1] ?? null);
      router.push("/settings/roles");
      router.refresh();
    } catch (e) {
      reportError(e, SERVER_RULES);
    } finally {
      setSaving(false);
    }
  }

  async function confirmed() {
    const what = confirm;
    setConfirm(null);
    if (!role || !what) return;
    try {
      const r = what === "delete" ? await removeRole(role.id) : await resetRole(role.id);
      if (!r.ok) return report(r.error);
      if (what === "delete") {
        router.push("/settings/roles");
      }
      router.refresh();
      if (what === "reset" && editor.defaults) setPerms(editor.defaults);
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid max-w-3xl grid-cols-1 gap-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={settingsLabel}>Role name *</label>
          <input data-field="name" className={settingsInput} value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(role?.isSystem)} placeholder="e.g. Cashier" />
        </div>
        <div>
          <label className={settingsLabel}>ID</label>
          <input className={`${settingsInput} bg-gray-50`} value={role?.code ?? "Assigned when saved"} readOnly tabIndex={-1} />
        </div>
        <div className="sm:col-span-2">
          <label className={settingsLabel}>Description</label>
          <input className={settingsInput} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} placeholder="What this role is for" />
        </div>
        <div>
          <label className={settingsLabel}>Status</label>
          <select className={settingsInput} value={isActive ? "active" : "inactive"} onChange={(e) => setIsActive(e.target.value === "active")} disabled={Boolean(role?.isSystem)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive (can&apos;t be given to anyone new)</option>
          </select>
        </div>
        {!role && (
          <div className="sm:col-span-3">
            <label className={settingsLabel}>Start from the permissions of</label>
            <select
              className={`${settingsInput} max-w-xs`}
              defaultValue=""
              onChange={(e) => {
                const src = editor.copyOptions.find((o) => o.id === e.target.value);
                if (src) setPerms(src.permissions);
              }}
            >
              <option value="">Nothing (start empty)</option>
              {editor.copyOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {readOnly && <p className="max-w-3xl rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">{role?.name} always has full access to everything, so there is nothing to adjust.</p>}

      <section data-field="matrix" className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Module</th>
              {PERMISSION_ACTIONS.map((a) => (
                <th key={a} className="px-3 py-2 text-center font-medium">
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" disabled={readOnly} checked={colAll(a)} onChange={(e) => setColumn(a, e.target.checked)} />
                    {ACTION_LABEL[a]}
                  </label>
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium">All</th>
            </tr>
          </thead>
          <tbody>
            {editor.catalog.map((m) => (
              <tr key={m.key} className="border-t border-[var(--card-border)]">
                <td className="px-4 py-2">
                  <p className="font-medium text-[var(--text-primary)]">{m.label}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{m.description}</p>
                  {(m.extras ?? []).map((e) => (
                    <label key={e.key} className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)]" title={e.help}>
                      <input type="checkbox" disabled={readOnly} checked={has(m.key, e.key)} onChange={(ev) => setExtra(m.key, e.key, ev.target.checked)} aria-label={`${m.label}: ${e.label}`} />
                      {e.label}
                    </label>
                  ))}
                </td>
                {PERMISSION_ACTIONS.map((a) => (
                  <td key={a} className="px-3 py-2 text-center">
                    {m.actions.includes(a) ? (
                      <input type="checkbox" disabled={readOnly} checked={has(m.key, a)} onChange={(e) => set(m.key, a, e.target.checked)} title={m.help?.[a] ?? ACTION_LABEL[a]} aria-label={`${m.label}: ${ACTION_LABEL[a]}`} />
                    ) : (
                      <span className="text-[var(--text-secondary)] opacity-40">—</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" disabled={readOnly} checked={rowAll(m)} onChange={(e) => setRow(m.key, e.target.checked)} aria-label={`${m.label}: everything`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="max-w-3xl text-xs text-[var(--text-secondary)]">
        Hover a tick for what it allows. Void covers cancelling or reversing a transaction; Delete covers removing records such as customers or accounts. Any action needs View. Changes apply to everyone with this role straight away.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && (
          <button type="button" onClick={save} disabled={saving} className={`${settingsButton} disabled:opacity-50`}>
            {saving ? "Saving..." : role ? "Save changes" : "Create role"}
          </button>
        )}
        <Link href="/settings/roles" className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          {readOnly ? "Back" : "Cancel"}
        </Link>
        {role && editor.defaults && (
          <button type="button" onClick={() => setConfirm("reset")} className="text-sm text-[var(--text-secondary)] hover:underline">
            Reset to default
          </button>
        )}
        {role && !role.isSystem && (
          <button type="button" onClick={() => setConfirm("delete")} className="ml-auto text-sm text-red-600 hover:underline">
            Delete role
          </button>
        )}
        {role && <span className="text-xs text-[var(--text-secondary)]">{role.members} user{role.members === 1 ? "" : "s"} with this role</span>}
      </div>

      {confirm && <ConfirmDialog message={confirm === "delete" ? `Delete the role "${role?.name}"?` : `Put ${role?.name} back to its standard permissions?`} onYes={confirmed} onNo={() => setConfirm(null)} />}
      {dialog}
    </div>
  );
}
