"use client";

import { useState } from "react";
import { SettingsForm } from "./settings-form";
import { ComponentsPanel } from "./components-panel";

const TABS = [
  { id: "settings", label: "Settings" },
  { id: "components", label: "Payroll Components" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SetupTabs({
  settings,
  components,
}: {
  settings: Parameters<typeof SettingsForm>[0]["settings"];
  components: Parameters<typeof ComponentsPanel>[0]["components"];
}) {
  const [tab, setTab] = useState<TabId>("settings");

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

      {tab === "settings" && <SettingsForm settings={settings} />}
      {tab === "components" && <ComponentsPanel components={components} />}
    </div>
  );
}
