"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createItem, type CreatedItem } from "./actions";
import { InfoDialog } from "../info-dialog";

type Unit = { id: string; name: string };
type Group = { id: string; name: string };
type Category = { id: string; name: string; groupId: string };

export function ItemAddForm({
  units,
  groups,
  categories,
  onCreated,
  embedded,
}: {
  units: Unit[];
  groups: Group[];
  categories: Category[];
  /** Called with the saved item (used when the form is opened from a sales/purchase screen). */
  onCreated?: (item: CreatedItem) => void;
  /** Inside a dialog: no card border, and no separate "created" message. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  const categoriesInGroup = useMemo(() => categories.filter((c) => c.groupId === groupId), [categories, groupId]);

  const purchase = parseFloat(purchasePrice) || 0;
  const selling = parseFloat(sellingPrice) || 0;
  const margin = selling - purchase;
  const marginPct = selling > 0 ? (margin / selling) * 100 : 0;

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
      const savedName = name.trim();
      const created = await createItem({ name, unitId, categoryId, purchasePrice: purchase, sellingPrice: selling });
      setName("");
      setUnitId("");
      setGroupId("");
      setCategoryId("");
      setPurchasePrice("");
      setSellingPrice("");
      if (onCreated) onCreated(created);
      else setCreatedName(savedName);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={embedded ? "space-y-4" : "max-w-xl space-y-4 rounded-lg border border-gray-200 bg-white p-5"}>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
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
        <div>
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
        <div>
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

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "+ Add item"}
        </button>
      </div>

      {createdName && <InfoDialog message={`${createdName} has been created`} onOk={() => setCreatedName(null)} />}
    </div>
  );
}
