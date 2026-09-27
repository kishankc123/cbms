"use client";

import { useMemo, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { createItem, type BillingType, type CreatedItem, type ItemType } from "./actions";
import { InfoDialog } from "../info-dialog";

type Unit = { id: string; name: string };
type Group = { id: string; name: string };
type Category = { id: string; name: string; groupId: string };
type Account = { id: string; code: string; name: string };

// Independent of item type — shown the same way for Product, Service, SaaS and Other.
const BILLING_TYPE_OPTIONS: { value: BillingType; label: string }[] = [
  { value: "one_time", label: "One-time" },
  { value: "recurring", label: "Recurring" },
  { value: "subscription", label: "Subscription" },
  { value: "usage_based", label: "Usage-based" },
];

export function ItemAddForm({
  itemType = "product",
  rateLabel = "Selling price",
  units,
  groups = [],
  categories = [],
  accounts = [],
  onCreated,
  embedded,
}: {
  /** Product shows purchase price/margin/category; Service, SaaS and Other never carry a cost, so those fields are hidden. */
  itemType?: ItemType;
  /** "Selling price" for Product; a Service/SaaS/Other item calls this its billing rate instead. */
  rateLabel?: string;
  units: Unit[];
  groups?: Group[];
  categories?: Category[];
  accounts?: Account[];
  /** Called with the saved item (used when the form is opened from a sales/purchase screen). */
  onCreated?: (item: CreatedItem) => void;
  /** Inside a dialog: no card border, and no separate "created" message. */
  embedded?: boolean;
}) {
  const isProduct = itemType === "product";
  const router = useRouter();
  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [inventoryTracking, setInventoryTracking] = useState(true);
  const [billingType, setBillingType] = useState<BillingType>("one_time");
  const [revenueAccountId, setRevenueAccountId] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const tracked = isProduct && inventoryTracking;
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();
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
    if (!name.trim()) {
      report("Item name is required.", null);
      return;
    }
    setSaving(true);
    try {
      const savedName = name.trim();
      const created = await createItem({ name, itemType, inventoryTracking, billingType, revenueAccountId: revenueAccountId || null, unitId, categoryId, purchasePrice: purchase, sellingPrice: selling });
      setName("");
      setUnitId("");
      setGroupId("");
      setCategoryId("");
      setInventoryTracking(true);
      setBillingType("one_time");
      setRevenueAccountId("");
      setPurchasePrice("");
      setSellingPrice("");
      if (onCreated) onCreated(created);
      else setCreatedName(savedName);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
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
          <label className="block text-xs text-gray-500 mb-1">Billing type</label>
          <select
            value={billingType}
            onChange={(e) => setBillingType(e.target.value as BillingType)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {BILLING_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Revenue account</label>
          <select
            value={revenueAccountId}
            onChange={(e) => setRevenueAccountId(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Use default (Sales Revenue)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        {isProduct && (
          <>
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
              <label className="block text-xs text-gray-500 mb-1">Track inventory</label>
              <select
                value={inventoryTracking ? "yes" : "no"}
                onChange={(e) => setInventoryTracking(e.target.value === "yes")}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="yes">Yes — moves stock, carries a cost</option>
                <option value="no">No — e.g. a digital download</option>
              </select>
            </div>
            {tracked && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Standard purchase price (excl. tax)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            )}
          </>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">{rateLabel}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        {tracked && (
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
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
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
      {dialog}
    </div>
  );
}
