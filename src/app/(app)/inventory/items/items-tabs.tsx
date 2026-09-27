"use client";

import { useState } from "react";
import { ItemsTable } from "./items-table";
import { ItemAddForm } from "./item-add-form";
import type { BillingType, ItemType } from "./actions";

type Unit = { id: string; name: string };
type Group = { id: string; name: string };
type Category = { id: string; name: string; groupId: string };
type Account = { id: string; code: string; name: string };
type Item = {
  id: string;
  name: string;
  unitId: string | null;
  categoryId: string | null;
  purchasePrice: string;
  sellingPrice: string;
  isActive: boolean;
  inventoryTracking: boolean;
  billingType: BillingType;
  revenueAccountId: string | null;
  stockQuantity: string;
  stockValue: string;
};

const TABS = [
  { id: "items", label: "Items" },
  { id: "add", label: "Add new" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ItemsTabs({
  itemType = "product",
  itemsLabel = "Items",
  rateLabel = "Selling price",
  items,
  units,
  groups = [],
  categories = [],
  accounts = [],
}: {
  itemType?: ItemType;
  /** The first tab's label, and what an empty/searched list calls its rows ("Items", "Services", "SaaS items", "Other items"). */
  itemsLabel?: string;
  rateLabel?: string;
  items: Item[];
  units: Unit[];
  groups?: Group[];
  categories?: Category[];
  accounts?: Account[];
}) {
  const [tab, setTab] = useState<TabId>("items");
  const tabs = TABS.map((t) => (t.id === "items" ? { ...t, label: itemsLabel } : t));

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              tab === t.id ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "items" && <ItemsTable itemType={itemType} rateLabel={rateLabel} items={items} units={units} groups={groups} categories={categories} accounts={accounts} />}
      {tab === "add" && <ItemAddForm itemType={itemType} rateLabel={rateLabel} units={units} groups={groups} categories={categories} accounts={accounts} />}
    </div>
  );
}
