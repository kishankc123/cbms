"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { updateItem } from "./actions";

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

export function EditItemModal({
  item,
  units,
  groups,
  categories,
  onClose,
}: {
  item: Item;
  units: Unit[];
  groups: Group[];
  categories: Category[];
  onClose: () => void;
}) {
  const router = useRouter();
  const initialCategory = categories.find((c) => c.id === item.categoryId);

  const [name, setName] = useState(item.name);
  const [unitId, setUnitId] = useState(item.unitId ?? "");
  const [groupId, setGroupId] = useState(initialCategory?.groupId ?? "");
  const [categoryId, setCategoryId] = useState(item.categoryId ?? "");
  const [purchasePrice, setPurchasePrice] = useState(item.purchasePrice);
  const [sellingPrice, setSellingPrice] = useState(item.sellingPrice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriesInGroup = useMemo(() => categories.filter((c) => c.groupId === groupId), [categories, groupId]);

  const purchase = parseFloat(purchasePrice) || 0;
  const selling = parseFloat(sellingPrice) || 0;
  const margin = selling - purchase;
  const marginPct = selling > 0 ? (margin / selling) * 100 : 0;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleGroupChange(value: string) {
    setGroupId(value);
    setCategoryId("");
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    setSaving(true);
    try {
      await updateItem({
        itemId: item.id,
        name,
        unitId,
        categoryId,
        purchasePrice: purchase,
        sellingPrice: selling,
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Edit item</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Unit</label>
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select unit</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Group</label>
              <select
                value={groupId}
                onChange={(e) => handleGroupChange(e.target.value)}
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
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={!groupId}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
              >
                <option value="">Select category</option>
                {categoriesInGroup.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Purchase price (excl. tax)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Selling price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Profit margin</label>
              <input
                type="text"
                readOnly
                value={margin.toFixed(2)}
                className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-700"
              />
              <p className="mt-1 text-xs text-gray-500">Margin: {marginPct.toFixed(2)}%</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {error && <span className="mr-auto self-center text-xs text-red-600">{error}</span>}
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
