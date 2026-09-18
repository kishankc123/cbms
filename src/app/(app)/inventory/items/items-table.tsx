"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteItem } from "./actions";
import { EditItemModal } from "./edit-item-modal";

type Unit = { id: string; name: string };
type Group = { id: string; name: string };
type Category = { id: string; name: string; groupId: string };
type Item = {
  id: string;
  name: string;
  unitId: string | null;
  categoryId: string | null;
  purchasePrice: string;
  sellingPrice: string;
};

type SortKey = "name" | "category";

export function ItemsTable({
  items,
  units,
  groups,
  categories,
}: {
  items: Item[];
  units: Unit[];
  groups: Group[];
  categories: Category[];
}) {
  const router = useRouter();
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = !q ? items : items.filter((it) => it.name.toLowerCase().includes(q));

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = sortKey === "category" ? categoryById.get(a.categoryId ?? "")?.name ?? "" : a.name;
        const bv = sortKey === "category" ? categoryById.get(b.categoryId ?? "")?.name ?? "" : b.name;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [items, search, categoryById, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  async function handleDelete(id: string, name: string) {
    setError(null);
    if (!confirm(`Delete item ${name}?`)) return;
    try {
      await deleteItem({ itemId: id });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items..."
          className="ml-auto rounded border border-gray-300 px-3 py-1.5 text-sm w-64"
        />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">SN</th>
            <th className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort("name")}>
              Items{sortIndicator("name")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("category")}
            >
              Category{sortIndicator("category")}
            </th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((it, i) => (
            <tr key={it.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{i + 1}</td>
              <td className="px-4 py-2">{it.name}</td>
              <td className="px-4 py-2">{categoryById.get(it.categoryId ?? "")?.name ?? "—"}</td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                <button type="button" onClick={() => setEditingId(it.id)} className="text-xs text-gray-600 hover:underline">
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(it.id, it.name)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                No items yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editingId && (
        <EditItemModal
          item={items.find((it) => it.id === editingId)!}
          units={units}
          groups={groups}
          categories={categories}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
