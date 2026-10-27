"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { adminCard, adminField } from "../../../../ui";
import { addCountrySetupItem, changeCountrySetupItem, type SetupListData } from "../../actions";

type Result = { ok: true } | { ok: false; error: string };

export function SetupList({ data }: { data: NonNullable<SetupListData> }) {
  const router = useRouter();
  const ask = useConfirm();
  const taxes = data.section === "taxes";
  const blank = { name: "", authorityKey: "", isRegistrable: false };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<{ id: string; name: string; authorityKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authorityName = (key?: string | null) => data.authorities.find((a) => a.key === key)?.name ?? "—";

  async function run(job: () => Promise<Result>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await job();
      if (!r.ok) return setError(r.error);
      onDone?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: (typeof data.rows)[number]) {
    if (row.isActive && !(await ask(`Deactivate ${row.name}? Records that already use it keep it. It just can't be chosen for new ones.`, { confirmLabel: "Deactivate", danger: true }))) return;
    run(() => changeCountrySetupItem(data.section, row.id, { isActive: !row.isActive }));
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addCountrySetupItem(data.countryCode, data.section, form), () => setForm(blank));
        }}
        className={`${adminCard} flex flex-wrap items-end gap-3 p-4`}
      >
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--text-secondary)]">Add a {data.singular}</span>
          <input className={`${adminField} w-64`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" required />
        </label>
        {taxes && (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--text-secondary)]">Authority</span>
              <select className={adminField} value={form.authorityKey} onChange={(e) => setForm({ ...form, authorityKey: e.target.value })}>
                <option value="">None</option>
                {data.authorities.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-sm text-[var(--text-primary)]">
              <input type="checkbox" checked={form.isRegistrable} onChange={(e) => setForm({ ...form, isRegistrable: e.target.checked })} />
              Organizations can register for it
            </label>
          </>
        )}
        <button type="submit" disabled={busy} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
          Add
        </button>
      </form>

      <div className={`${adminCard} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)] text-left text-xs text-[var(--text-secondary)]">
              <th className="px-4 py-2">Name</th>
              {taxes && <th className="px-4 py-2">Authority</th>}
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--text-secondary)]">
                  Nothing here yet.
                </td>
              </tr>
            )}
            {data.rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--card-border)] last:border-0">
                {editing?.id === row.id ? (
                  <>
                    <td className="px-4 py-2">
                      <input className={`${adminField} w-64`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                    </td>
                    {taxes && (
                      <td className="px-4 py-2">
                        <select className={adminField} value={editing.authorityKey} onChange={(e) => setEditing({ ...editing, authorityKey: e.target.value })}>
                          <option value="">None</option>
                          {data.authorities.map((a) => (
                            <option key={a.key} value={a.key}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="px-4 py-2" />
                    <td className="space-x-3 px-4 py-2 text-right">
                      <button type="button" disabled={busy} onClick={() => run(() => changeCountrySetupItem(data.section, row.id, { name: editing.name, ...(taxes ? { authorityKey: editing.authorityKey } : {}) }), () => setEditing(null))} className="text-sm text-[var(--color-primary)]">
                        Save
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="text-sm text-[var(--text-secondary)]">
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className={`px-4 py-2 font-medium ${row.isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>{row.name}</td>
                    {taxes && <td className="px-4 py-2">{authorityName(row.authorityKey)}</td>}
                    <td className="px-4 py-2">{row.isActive ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="action">Inactive</StatusPill>}</td>
                    <td className="space-x-3 px-4 py-2 text-right">
                      <button type="button" disabled={busy} onClick={() => setEditing({ id: row.id, name: row.name, authorityKey: row.authorityKey ?? "" })} className="text-sm text-[var(--color-primary)]">
                        Edit
                      </button>
                      <button type="button" disabled={busy} onClick={() => toggle(row)} className={`text-sm ${row.isActive ? "text-red-600" : "text-[var(--color-primary)]"}`}>
                        {row.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
