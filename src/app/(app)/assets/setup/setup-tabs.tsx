"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RowMenu } from "@/components/row-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { useProblem } from "@/components/problem-dialog";
import { saveAssetAccounts, saveAssetCategory, saveAssetLocation, saveAssetSettings, type AssetSetupData, type CategoryInput } from "./actions";

const TABS = [
  { id: "general", label: "General" },
  { id: "accounts", label: "Default accounts" },
  { id: "categories", label: "Categories" },
  { id: "locations", label: "Locations" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const input = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500";
const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5";
const METHOD_LABEL = { straight_line: "Straight line", declining_balance: "Declining balance", none: "No depreciation" } as const;
const primaryBtn = "rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50";

export function SetupTabs({ data }: { data: AssetSetupData }) {
  const [tab, setTab] = useState<TabId>("general");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-[var(--surface-muted-bg)] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${tab === t.id ? "bg-[var(--card-bg)] text-[var(--text-primary)] font-medium shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!data.canEdit && <p className="rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-xs text-[var(--text-secondary)]">You can view these settings but not change them.</p>}
      {tab === "general" && <GeneralPanel data={data} />}
      {tab === "accounts" && <AccountsPanel data={data} />}
      {tab === "categories" && <CategoriesPanel data={data} />}
      {tab === "locations" && <LocationsPanel data={data} />}
    </div>
  );
}

function GeneralPanel({ data }: { data: AssetSetupData }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [prefix, setPrefix] = useState(data.settings.codePrefix);
  const [auto, setAuto] = useState(data.settings.autoGenerateCode);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const r = await saveAssetSettings({ codePrefix: prefix, autoGenerateCode: auto });
      if (!r.ok) return report(r.error, '[data-field="prefix"]');
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} max-w-xl space-y-4`}>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Asset code prefix</label>
        <input data-field="prefix" className={input} value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={!data.canEdit} />
        <p className="mt-1 text-xs text-[var(--text-secondary)]">Codes are numbered in sequence, for example {prefix.trim() || ""}000001, {prefix.trim() || ""}000002.</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!data.canEdit} />
        Generate asset codes automatically (authorized users can still type their own)
      </label>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Default depreciation frequency</label>
        <select className={input} value="monthly" disabled>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      {data.canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
            {busy ? "Saving..." : "Save"}
          </button>
          {saved && <span className="text-xs text-green-600">Saved</span>}
        </div>
      )}
      {dialog}
    </div>
  );
}

function AccountsPanel({ data }: { data: AssetSetupData }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(data.roles.map((r) => [r.key, r.accountId])));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const r = await saveAssetAccounts(choice);
      if (!r.ok) return report(r.error);
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} max-w-2xl space-y-4`}>
      <p className="text-sm text-[var(--text-secondary)]">The accounts the Assets module posts to. Standard accounts were created for you; change one only if you keep these in a different account.</p>
      {data.roles.map((role) => (
        <div key={role.key}>
          <label className="block text-xs text-gray-500 mb-1">{role.label}</label>
          <select className={input} value={choice[role.key]} onChange={(e) => setChoice({ ...choice, [role.key]: e.target.value })} disabled={!data.canEdit}>
            {data.chart
              .filter((a) => a.category === role.category)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{role.help}</p>
        </div>
      ))}
      {data.canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
            {busy ? "Saving..." : "Save accounts"}
          </button>
          {saved && <span className="text-xs text-green-600">Saved</span>}
        </div>
      )}
      {dialog}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-lg bg-[var(--card-bg)] p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type CategoryRow = AssetSetupData["categories"][number];
const blankCategory: CategoryInput = { name: "", method: "straight_line", lifeYears: 5, residualPercent: 0, isActive: true };

function CategoriesPanel({ data }: { data: AssetSetupData }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [editing, setEditing] = useState<CategoryInput | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = (c: CategoryRow) => setEditing({ id: c.id, name: c.name, method: c.method, lifeYears: c.lifeYears, residualPercent: c.residualPercent, isActive: c.isActive });

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const r = await saveAssetCategory(editing);
      if (!r.ok) return report(r.error, /name|already/i.test(r.error) ? '[data-field="catName"]' : /life/i.test(r.error) ? '[data-field="catLife"]' : /residual/i.test(r.error) ? '[data-field="catResidual"]' : '[data-field="catMethod"]');
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {data.canEdit && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setEditing({ ...blankCategory })} className={primaryBtn}>
            + Add category
          </button>
        </div>
      )}
      <table className="w-full text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg overflow-hidden">
        <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
          <tr>
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">Default method</th>
            <th className="px-4 py-2 font-medium text-right">Useful life</th>
            <th className="px-4 py-2 font-medium text-right">Residual</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {data.categories.map((c) => (
            <tr key={c.id} className={`border-t border-[var(--card-border)] ${c.isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
              <td className="px-4 py-2">{c.name}</td>
              <td className="px-4 py-2">{METHOD_LABEL[c.method]}</td>
              <td className="px-4 py-2 text-right">{c.lifeYears ? `${c.lifeYears} yr` : "—"}</td>
              <td className="px-4 py-2 text-right">{c.method === "none" ? "—" : `${c.residualPercent}%`}</td>
              <td className="px-4 py-2">
                <StatusPill tone={c.isActive ? "success" : "action"}>{c.isActive ? "Active" : "Inactive"}</StatusPill>
              </td>
              <td className="px-4 py-2 text-right">{data.canEdit && <RowMenu items={[{ label: "Edit", onClick: () => edit(c) }]} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-[var(--text-secondary)]">These are defaults for a new asset; each asset can override them. Categories are never deleted — switch one off to stop using it.</p>

      {editing && (
        <Modal title={editing.id ? "Edit category" : "Add category"} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input data-field="catName" autoFocus className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default depreciation method</label>
              <select data-field="catMethod" className={input} value={editing.method} onChange={(e) => setEditing({ ...editing, method: e.target.value as CategoryInput["method"], lifeYears: e.target.value === "none" ? null : editing.lifeYears ?? 5 })}>
                {Object.entries(METHOD_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {editing.method !== "none" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Useful life (years)</label>
                  <input data-field="catLife" type="number" min="1" max="100" step="1" className={input} value={editing.lifeYears ?? ""} onChange={(e) => setEditing({ ...editing, lifeYears: e.target.value === "" ? null : Number(e.target.value) })} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Residual value (% of cost)</label>
                  <input data-field="catResidual" type="number" min="0" max="100" step="0.01" className={input} value={editing.residualPercent} onChange={(e) => setEditing({ ...editing, residualPercent: Number(e.target.value) })} />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
              Active
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog}
    </div>
  );
}

type LocationRow = AssetSetupData["locations"][number];

function LocationsPanel({ data }: { data: AssetSetupData }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [editing, setEditing] = useState<{ id?: string; name: string; isActive: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = (l: LocationRow) => setEditing({ id: l.id, name: l.name, isActive: l.isActive });

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const r = await saveAssetLocation(editing);
      if (!r.ok) return report(r.error, '[data-field="locName"]');
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {data.canEdit && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setEditing({ name: "", isActive: true })} className={primaryBtn}>
            + Add location
          </button>
        </div>
      )}
      <table className="w-full text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg overflow-hidden max-w-2xl">
        <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
          <tr>
            <th className="px-4 py-2 font-medium">Location</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {data.locations.map((l) => (
            <tr key={l.id} className={`border-t border-[var(--card-border)] ${l.isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
              <td className="px-4 py-2">{l.name}</td>
              <td className="px-4 py-2">
                <StatusPill tone={l.isActive ? "success" : "action"}>{l.isActive ? "Active" : "Inactive"}</StatusPill>
              </td>
              <td className="px-4 py-2 text-right">{data.canEdit && <RowMenu items={[{ label: "Edit", onClick: () => edit(l) }]} />}</td>
            </tr>
          ))}
          {data.locations.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                No locations yet. Add the places your assets are kept, such as &quot;Head office&quot; or &quot;Warehouse&quot;.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && (
        <Modal title={editing.id ? "Edit location" : "Add location"} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input data-field="locName" autoFocus className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
              Active
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
