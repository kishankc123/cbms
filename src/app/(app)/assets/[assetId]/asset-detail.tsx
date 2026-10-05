"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { useProblem } from "@/components/problem-dialog";
import { formatDateTime } from "@/lib/calendar";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { updateAsset, voidAssetPurchaseAction, voidOpeningAssetAction, type AssetDetailData } from "../actions";
import { METHOD_LABEL, money } from "../shared";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "purchase", label: "Purchase" },
  { id: "depreciation", label: "Accounting depreciation" },
  { id: "transactions", label: "Transactions" },
  { id: "audit", label: "Audit history" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";
const input = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm";
const primaryBtn = "rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--text-primary)]">{children || "—"}</p>
    </div>
  );
}

const lifeText = (months: number | null) => {
  if (!months) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} year${y === 1 ? "" : "s"}` : "", m ? `${m} month${m === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ");
};

export function AssetDetail({ data }: { data: AssetDetailData }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [tab, setTab] = useState<TabId>("overview");
  const [editing, setEditing] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  // A purchase can be voided only while nothing depends on it: bought here, still active, not yet depreciated.
  const isOpening = data.asset.source === "opening";
  const canVoidPurchase = data.canVoid && (isOpening ? ["active", "fully_depreciated"].includes(data.asset.status) : data.asset.source === "purchase" && data.asset.status === "active") && !data.asset.lastDepreciationDate;

  async function confirmVoid() {
    setConfirmingVoid(false);
    const r = isOpening ? await voidOpeningAssetAction(data.asset.id) : await voidAssetPurchaseAction(data.asset.id);
    if (!r.ok) return report(r.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-full bg-[var(--surface-muted-bg)] p-1">
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
        <div className="flex items-center gap-2">
          {canVoidPurchase && (
            <button type="button" onClick={() => setConfirmingVoid(true)} className="rounded border border-[var(--card-border)] px-4 py-1.5 text-sm text-red-600 hover:bg-[var(--surface-muted-bg)]">
              {isOpening ? "Void opening asset" : "Void purchase"}
            </button>
          )}
          {data.canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="rounded border border-[var(--card-border)] px-4 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-muted-bg)]">
              Edit asset
            </button>
          )}
        </div>
      </div>

      {tab === "overview" && <Overview data={data} />}
      {tab === "purchase" && <Purchase data={data} />}
      {tab === "depreciation" && <Depreciation data={data} />}
      {tab === "transactions" && <Transactions data={data} />}
      {tab === "audit" && <Audit data={data} />}
      {editing && <EditModal data={data} onClose={() => setEditing(false)} />}
      {confirmingVoid && (
        <ConfirmDialog
          message={isOpening ? `Void opening asset ${data.asset.assetCode}? Its opening entry is reversed and the asset is taken off the register.` : `Void the purchase of ${data.asset.assetCode}? Its accounting entries and supplier bill are reversed and the asset is taken off the register.`}
          onYes={confirmVoid}
          onNo={() => setConfirmingVoid(false)}
        />
      )}
      {dialog}
    </div>
  );
}

function Overview({ data }: { data: AssetDetailData }) {
  const a = data.asset;
  return (
    <div className={`${card} grid grid-cols-1 gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3`}>
      <Field label="Asset code">{a.assetCode}</Field>
      <Field label="Asset name">{a.name}</Field>
      <Field label="Accounting category">{a.categoryName}</Field>
      <Field label="Location">{a.locationName}</Field>
      <Field label="Source">{a.source === "opening" ? "Opening asset (brought in from before the books started)" : "Purchased"}</Field>
      <Field label="Purchase date">{a.purchaseDate ? <D value={a.purchaseDate} /> : null}</Field>
      <Field label="Available-for-use date">{a.availableForUseDate ? <D value={a.availableForUseDate} /> : null}</Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <Field label="Description">{a.description}</Field>
      </div>
    </div>
  );
}

function Purchase({ data }: { data: AssetDetailData }) {
  const a = data.asset;
  return (
    <div className="space-y-4">
      {a.source === "opening" && <p className="rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-xs text-[var(--text-secondary)]">This is an opening asset, so there is no purchase transaction. Its cost is the original cost.</p>}
      <div className={`${card} grid grid-cols-1 gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3`}>
        <Field label="Supplier">{a.supplierName}</Field>
        <Field label="Supplier PAN">{a.supplierPan}</Field>
        <Field label="Invoice number">{a.invoiceNumber}</Field>
        <Field label="Purchase order number">{a.purchaseOrderNumber}</Field>
        <Field label="Purchase reference">{a.purchaseReference}</Field>
        <Field label="Supporting document">{a.supportingDocument}</Field>
      </div>
      <div className={`${card} p-5`}>
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Cost</h3>
        <dl className="max-w-md space-y-1.5 text-sm">
          {[
            ["Purchase price", a.purchasePrice],
            ["Freight", a.freightCost],
            ["Installation", a.installationCost],
            ["Other directly attributable cost", a.otherCost],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between">
              <dt className="text-[var(--text-secondary)]">{label}</dt>
              <dd className="tabular-nums text-[var(--text-primary)]">{money(value as number)}</dd>
            </div>
          ))}
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">VAT on the invoice</dt>
            <dd className="tabular-nums text-[var(--text-secondary)]">{money(a.vatAmount)}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--card-border)] pt-2 font-semibold">
            <dt className="text-[var(--text-primary)]">Capitalized cost</dt>
            <dd className="tabular-nums text-[var(--text-primary)]">{money(a.capitalizedCost)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-[var(--text-secondary)]">Recoverable input VAT stays out of the capitalized cost; VAT that can&apos;t be recovered is part of it.</p>
      </div>
    </div>
  );
}

function Depreciation({ data }: { data: AssetDetailData }) {
  const a = data.asset;
  const [all, setAll] = useState(false);
  const rows = all ? data.schedule : data.schedule.slice(0, 12);
  return (
    <div className="space-y-4">
      <div className={`${card} grid grid-cols-1 gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3`}>
        <Field label="Method">{METHOD_LABEL[a.depreciationMethod]}</Field>
        {a.originalUsefulLifeMonths ? <Field label="Original useful life">{lifeText(a.originalUsefulLifeMonths)}</Field> : null}
        <Field label="Useful life (remaining to depreciate)">{lifeText(a.usefulLifeMonths)}</Field>
        <Field label="Residual value">{money(a.residualValue)}</Field>
        <Field label="Depreciation start date">{a.depreciationStartDate ? <D value={a.depreciationStartDate} /> : null}</Field>
        <Field label="Depreciation before the books started">{money(a.openingAccumulatedDepreciation)}</Field>
        <Field label="Still to depreciate">{money(a.remainingDepreciable)}</Field>
        <Field label="Last depreciation posted">{a.lastDepreciationDate ? <D value={a.lastDepreciationDate} /> : "None yet"}</Field>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <div className="flex items-center justify-between px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Depreciation schedule</h3>
          <span className="text-xs text-[var(--text-secondary)]">A projection from the settings above; monthly depreciation is posted from Assets &gt; Depreciation.</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Period</th>
              <th className="px-4 py-2 font-medium text-right">Opening NBV</th>
              <th className="px-4 py-2 font-medium text-right">Depreciation</th>
              <th className="px-4 py-2 font-medium text-right">Closing NBV</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number} className="border-t border-[var(--card-border)]">
                <td className="px-4 py-2 text-[var(--text-primary)]">{r.label}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(r.opening)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(r.depreciation)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-primary)]">{money(r.closing)}</td>
                <td className="px-4 py-2 text-xs text-[var(--text-secondary)]">{r.posted ? "Posted" : "Scheduled"}</td>
              </tr>
            ))}
            {data.schedule.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  {a.depreciationMethod === "none" ? "This asset is not depreciated." : "Set a useful life and a depreciation start date to see the schedule."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data.schedule.length > 12 && (
          <div className="border-t border-[var(--card-border)] px-5 py-2 text-center">
            <button type="button" onClick={() => setAll(!all)} className="text-sm text-[var(--color-primary)] hover:underline">
              {all ? "Show first 12 periods" : `Show all ${data.schedule.length} periods`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Transactions({ data }: { data: AssetDetailData }) {
  return (
    <div className={`${card} p-5`}>
      {data.events.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-secondary)]">No transactions recorded for this asset yet. Its purchase, depreciation and disposal appear here as they happen.</p>
      ) : (
        <ol className="space-y-4 border-l border-[var(--card-border)] pl-5">
          {data.events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[26px] top-1.5 h-2 w-2 rounded-full bg-[var(--color-primary)]" />
              <p className="text-xs text-[var(--text-secondary)]">
                <D value={e.eventDate} />
              </p>
              <p className="text-sm text-[var(--text-primary)]">
                {e.description}
                {e.amount !== null && <span className="ml-2 tabular-nums text-[var(--text-secondary)]">{money(e.amount)}</span>}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = { name: "Name", description: "Description", categoryId: "Category", locationId: "Location", method: "Method", usefulLifeMonths: "Useful life (months)", residualValue: "Residual value", startDate: "Start date" };

function changes(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  return Object.keys(a)
    .filter((k) => String(a[k] ?? "") !== String(b[k] ?? ""))
    .map((k) => `${FIELD_LABEL[k] ?? k}: ${String(b[k] ?? "—")} → ${String(a[k] ?? "—")}`);
}

function Audit({ data }: { data: AssetDetailData }) {
  const calendar = useCalendar();
  return (
    <div className={`${card} p-5`}>
      {data.audit.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-secondary)]">No changes have been made to this asset.</p>
      ) : (
        <ul className="space-y-3">
          {data.audit.map((e) => (
            <li key={e.id} className="text-sm">
              <p className="text-[var(--text-primary)]">
                {e.action === "asset_changed" ? "Details changed" : e.action}
                <span className="ml-2 text-xs text-[var(--text-secondary)]">
                  {formatDateTime(e.at, calendar)} · {e.userName ?? "System"}
                </span>
              </p>
              {changes(e.before, e.after).map((c) => (
                <p key={c} className="text-xs text-[var(--text-secondary)]">
                  {c}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditModal({ data, onClose }: { data: AssetDetailData; onClose: () => void }) {
  const router = useRouter();
  const a = data.asset;
  const { report, dialog } = useProblem();
  const retired = ["disposed", "sold", "written_off"].includes(a.status);
  const canEditDepreciation = !retired && !a.lastDepreciationDate;

  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description);
  const [categoryId, setCategoryId] = useState(a.categoryId);
  const [locationId, setLocationId] = useState(a.locationId ?? "");
  const [method, setMethod] = useState(a.depreciationMethod);
  const [months, setMonths] = useState(a.usefulLifeMonths ? String(a.usefulLifeMonths) : "");
  const [residual, setResidual] = useState(String(a.residualValue));
  const [startDate, setStartDate] = useState(a.depreciationStartDate ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await updateAsset(a.id, {
        name,
        description,
        categoryId,
        locationId: locationId || null,
        ...(canEditDepreciation ? { depreciation: { method, usefulLifeMonths: method === "none" ? null : Number(months) || null, residualValue: Number(residual) || 0, startDate: startDate || null } } : {}),
      });
      if (!r.ok) {
        const target = /name/i.test(r.error) ? '[data-field="aName"]' : /categor/i.test(r.error) ? '[data-field="aCategory"]' : /location/i.test(r.error) ? '[data-field="aLocation"]' : /life/i.test(r.error) ? '[data-field="aLife"]' : /residual/i.test(r.error) ? '[data-field="aResidual"]' : /start date/i.test(r.error) ? "#asset-start" : '[data-field="aMethod"]';
        return report(r.error, target);
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg space-y-4 rounded-lg bg-[var(--card-bg)] p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Edit asset</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Asset name</label>
            <input data-field="aName" autoFocus className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Accounting category</label>
              <select data-field="aCategory" className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {data.categories
                  .filter((c) => c.isActive || c.id === a.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Location</label>
              <select data-field="aLocation" className={input} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">No location</option>
                {data.locations
                  .filter((l) => l.isActive || l.id === a.locationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Description</label>
            <textarea rows={2} className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="border-t border-[var(--card-border)] pt-3">
            <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Depreciation</p>
            {canEditDepreciation ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Method</label>
                  <select data-field="aMethod" className={input} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                    {Object.entries(METHOD_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {method !== "none" && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Useful life (months)</label>
                      <input data-field="aLife" type="number" min="1" step="1" className={input} value={months} onChange={(e) => setMonths(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Residual value</label>
                      <input data-field="aResidual" type="number" min="0" step="0.01" className={input} value={residual} onChange={(e) => setResidual(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Start date</label>
                      <DatePicker id="asset-start" value={startDate} onChange={setStartDate} className={input} />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">{retired ? "This asset is no longer on the books, so its depreciation can't be changed." : "Depreciation has already been posted, so these settings are locked."}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
        {dialog}
      </div>
    </div>
  );
}
