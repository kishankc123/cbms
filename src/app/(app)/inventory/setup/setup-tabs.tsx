"use client";

import { useState } from "react";
import { NamedListPanel } from "./named-list-panel";
import { CategoriesPanel } from "./categories-panel";
import { StockSettingsPanel } from "./stock-settings-panel";
import { createUnit, updateUnit, deleteUnit, createGroup, updateGroup, deleteGroup } from "./actions";

type NamedRow = { id: string; name: string };
type Category = { id: string; name: string; groupId: string };

const TABS = [
  { id: "units", label: "Units" },
  { id: "groups", label: "Groups" },
  { id: "categories", label: "Categories" },
  { id: "stock", label: "Stock" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SetupTabs({
  units,
  groups,
  categories,
  allowNegativeStock,
}: {
  allowNegativeStock: boolean;
  units: NamedRow[];
  groups: NamedRow[];
  categories: Category[];
}) {
  const [tab, setTab] = useState<TabId>("units");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "units" && (
        <NamedListPanel
          label="Unit"
          rows={units}
          onCreate={(name) => createUnit({ name })}
          onUpdate={(unitId, name) => updateUnit({ unitId, name })}
          onDelete={(unitId) => deleteUnit({ unitId })}
        />
      )}
      {tab === "groups" && (
        <NamedListPanel
          label="Group"
          rows={groups}
          onCreate={(name) => createGroup({ name })}
          onUpdate={(groupId, name) => updateGroup({ groupId, name })}
          onDelete={(groupId) => deleteGroup({ groupId })}
        />
      )}
      {tab === "categories" && <CategoriesPanel categories={categories} groups={groups} />}
      {tab === "stock" && <StockSettingsPanel allowNegativeStock={allowNegativeStock} />}
    </div>
  );
}
