"use client";

import { useEffect, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { InfoDialog } from "../info-dialog";

type Row = { id: string; name: string };

// Shared CRUD list UI for simple name-only master data (Units, Groups) — an
// "Add new" popup, inline rename-on-edit, and a delete button that surfaces
// the server's guard message (e.g. "in use") if delete is refused.
export function NamedListPanel({
  label,
  rows,
  onCreate,
  onUpdate,
  onDelete,
}: {
  label: string;
  rows: Row[];
  onCreate: (name: string) => Promise<void>;
  onUpdate: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);

  useEffect(() => {
    if (!showAdd) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAdd(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAdd]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const savedName = newName.trim();
      await onCreate(savedName);
      setNewName("");
      setShowAdd(false);
      setCreatedName(savedName);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    setBusy(true);
    try {
      await onUpdate(id, editName.trim());
      setEditingId(null);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    setBusy(true);
    try {
      await onDelete(id);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to delete", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="ml-auto rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          + Add new
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">{label}</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-2">
                {editingId === r.id ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    size={15}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                ) : (
                  r.name
                )}
              </td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                {editingId === r.id ? (
                  <>
                    <button type="button" onClick={() => handleUpdate(r.id)} disabled={busy} className="text-xs text-gray-900 hover:underline">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gray-600 hover:underline">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(r.id);
                        setEditName(r.name);
                      }}
                      className="text-xs text-gray-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(r.id, r.name)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className="px-4 py-6 text-center text-gray-400">
                No {label.toLowerCase()}s yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowAdd(false)} />

          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Add {label.toLowerCase()}</h2>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{label} name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={busy}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createdName && <InfoDialog message={`${createdName} has been created`} onOk={() => setCreatedName(null)} />}
      {dialog}
    </div>
  );
}
