"use client";

import { useState } from "react";
import { ItemsTable } from "./items-table";
import { ItemAddForm } from "./item-add-form";

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
  isActive: boolean;
  stockQuantity: string;
  stockValue: string;
};

const TABS = [
  { id: "items", label: "Items" },
  { id: "add", label: "Add new" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ItemsTabs({
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
  const [tab, setTab] = useState<TabId>("items");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
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

      {tab === "items" && <ItemsTable items={items} units={units} groups={groups} categories={categories} />}
      {tab === "add" && <ItemAddForm units={units} groups={groups} categories={categories} />}
    </div>
  );
}
