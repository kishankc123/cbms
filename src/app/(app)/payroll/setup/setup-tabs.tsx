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

      {tab === "settings" && <SettingsForm settings={settings} />}
      {tab === "components" && <ComponentsPanel components={components} />}
    </div>
  );
}
