"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { settingsButton, settingsInput, settingsLabel } from "../ui";
import { removePaymentMode, savePaymentMode, type PaymentModesData } from "./actions";

type Mode = PaymentModesData["modes"][number];
type Editing = { id: string | null; name: string; isActive: boolean; accountIds: string[] };

export function ModesScreen({ data }: { data: PaymentModesData }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Mode | null>(null);
  const [saving, setSaving] = useState(false);

  const unlinked = data.linkable.filter((a) => a.modes.length === 0);

  function startEdit(m: Mode) {
    setEditing({ id: m.id, name: m.name, isActive: m.isActive, accountIds: m.accounts.filter((a) => a.usable).map((a) => a.id) });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const r = await savePaymentMode(editing.id, { name: editing.name, isActive: editing.isActive, accountIds: editing.accountIds });
      if (!r.ok) return report(r.error);
      setEditing(null);
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const m = deleting;
    setDeleting(null);
    if (!m) return;
    try {
      const r = await removePaymentMode(m.id);
      if (!r.ok) return report(r.error);
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  const groups = new Map<string, PaymentModesData["linkable"]>();
  for (const a of data.linkable) groups.set(a.group ?? "", [...(groups.get(a.group ?? "") ?? []), a]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={settingsButton} onClick={() => setEditing({ id: null, name: "", isActive: true, accountIds: [] })}>
          Add mode
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Mode</th>
              <th className="px-4 py-2 font-medium">Linked accounts</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.modes.map((m) => (
              <tr key={m.id} className="border-t border-[var(--card-border)] align-top">
                <td className="px-4 py-2 font-medium">{m.name}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  {m.accounts.length === 0 ? (
                    <span>Not linked yet</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {m.accounts.map((a) => (
                        <li key={a.id} className={a.usable ? "" : "text-red-600"}>
                          {a.code} — {a.name}
                          {!a.usable && " (now has sub-groups or is inactive: link its sub-groups instead)"}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-2">
                  <StatusPill tone={m.isActive ? "success" : "pending"}>{m.isActive ? "Active" : "Inactive"}</StatusPill>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  <button type="button" className="mr-3 text-[var(--color-primary)] hover:underline" onClick={() => startEdit(m)}>
                    Edit
                  </button>
                  <button type="button" className="text-red-600 hover:underline" onClick={() => setDeleting(m)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {data.modes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--text-secondary)]">
                  No modes yet. Add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {unlinked.length > 0 && (
        <p className="rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          Not linked to any mode yet: {unlinked.map((a) => `${a.code} ${a.name}`).join(", ")}.
        </p>
      )}

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !saving && setEditing(null)} />
          <div className="relative max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-[var(--card-bg)] p-5 shadow-lg">
            <h2 className="text-lg font-medium text-[var(--text-primary)]">{editing.id ? "Edit mode" : "Add mode"}</h2>
            <div>
              <label className={settingsLabel}>Name</label>
              <input className={settingsInput} value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
              Active
            </label>
            <div>
              <p className={settingsLabel}>Accounts for this mode</p>
              <p className="mb-2 text-xs text-[var(--text-secondary)]">Only lowest-level accounts can be linked: a group that has sub-groups is shown as a heading, and its sub-groups are linked. An account can be linked to several modes, for example a bank used for cheques, transfers, Fonepay and cards.</p>
              <div className="space-y-3 rounded border border-[var(--card-border)] p-3">
                {[...groups.entries()].map(([group, list]) => (
                  <div key={group || "top"}>
                    {group && <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{group}</p>}
                    <ul className="space-y-1">
                      {list.map((a) => {
                        const checked = editing.accountIds.includes(a.id);
                        return (
                          <li key={a.id}>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => setEditing({ ...editing, accountIds: e.target.checked ? [...editing.accountIds, a.id] : editing.accountIds.filter((id) => id !== a.id) })}
                              />
                              {a.code} — {a.name}
                              {a.modes.filter((x) => x.id !== editing.id).length > 0 && <span className="text-xs text-[var(--text-secondary)]">(also in {a.modes.filter((x) => x.id !== editing.id).map((x) => x.name).join(", ")})</span>}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {data.linkable.length === 0 && <p className="text-sm text-[var(--text-secondary)]">There are no cash, bank or wallet accounts to link. Add them in the Chart of Accounts first.</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setEditing(null)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={save} className={settingsButton}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete the mode "${deleting.name}"? Its accounts stay as they are and past transactions do not change; they just will not belong to a mode.`}
          onYes={confirmDelete}
          onNo={() => setDeleting(null)}
        />
      )}
      {dialog}
    </div>
  );
}
