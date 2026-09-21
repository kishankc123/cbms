"use client";

import { useEffect, useMemo, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { createCategory, updateCategory, deleteCategory } from "./actions";
import { InfoDialog } from "../info-dialog";

type Group = { id: string; name: string };
type Category = { id: string; name: string; groupId: string };

type SortKey = "name" | "group";

export function CategoriesPanel({ categories, groups }: { categories: Category[]; groups: Group[] }) {
  const router = useRouter();
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [createdName, setCreatedName] = useState<string | null>(null);

  useEffect(() => {
    if (!showAdd) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAdd(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAdd]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return categories;
    return [...categories].sort((a, b) => {
      const av = sortKey === "group" ? groupById.get(a.groupId)?.name ?? "" : a.name;
      const bv = sortKey === "group" ? groupById.get(b.groupId)?.name ?? "" : b.name;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [categories, groupById, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  async function handleCreate() {
    if (!newName.trim() || !newGroupId) return;
    setBusy(true);
    try {
      const savedName = newName.trim();
      await createCategory({ name: savedName, groupId: newGroupId });
      setNewName("");
      setNewGroupId("");
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
    if (!editName.trim() || !editGroupId) return;
    setBusy(true);
    try {
      await updateCategory({ categoryId: id, name: editName.trim(), groupId: editGroupId });
      setEditingId(null);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete category ${name}?`)) return;
    setBusy(true);
    try {
      await deleteCategory({ categoryId: id });
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
          disabled={groups.length === 0}
          className="ml-auto rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          + Add new
        </button>
      </div>

      {groups.length === 0 && <p className="text-xs text-gray-500">Add a group first — categories are created under a group.</p>}

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort("name")}>
              Category{sortIndicator("name")}
            </th>
            <th className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort("group")}>
              Group{sortIndicator("group")}
            </th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="px-4 py-2">
                {editingId === c.id ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    size={15}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                ) : (
                  c.name
                )}
              </td>
              <td className="px-4 py-2">
                {editingId === c.id ? (
                  <select
                    value={editGroupId}
                    onChange={(e) => setEditGroupId(e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  groupById.get(c.groupId)?.name ?? "—"
                )}
              </td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                {editingId === c.id ? (
                  <>
                    <button type="button" onClick={() => handleUpdate(c.id)} disabled={busy} className="text-xs text-gray-900 hover:underline">
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
                        setEditingId(c.id);
                        setEditName(c.name);
                        setEditGroupId(c.groupId);
                      }}
                      className="text-xs text-gray-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(c.id, c.name)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                No categories yet
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
              <h2 className="text-base font-semibold text-gray-900">Add category</h2>
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
              <label className="block text-xs text-gray-500 mb-1">Group</label>
              <select
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category name</label>
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
