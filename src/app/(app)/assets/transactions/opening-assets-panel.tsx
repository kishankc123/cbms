"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/calendar/date-picker";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { useProblem, type FieldRules } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/calendar";
import { openingAssetAmounts } from "@/lib/assets/opening-math";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { createOpeningAsset, updateOpeningAssetAction, voidOpeningAssetAction, type OpeningAssetsData } from "../actions";
import { METHOD_LABEL, STATUS_LABEL, STATUS_TONE, money } from "../shared";

type Method = "straight_line" | "declining_balance" | "none";
type Row = OpeningAssetsData["assets"][number];

const input = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const label = "mb-1 block text-xs text-gray-500";
const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";
const num = (v: string) => (v.trim() === "" ? 0 : Number(v) || 0);

const SERVER_RULES: FieldRules = [
  [/asset code/i, '[data-field="code"]'],
  [/asset name/i, '[data-field="name"]'],
  [/categor/i, '[data-field="category"]'],
  [/location/i, '[data-field="location"]'],
  [/original purchase date|before your books/i, "#oa-date"],
  [/original cost/i, '[data-field="cost"]'],
  [/accumulated/i, '[data-field="accumulated"]'],
  [/residual/i, '[data-field="residual"]'],
  [/remaining useful life|original useful life/i, '[data-field="remaining"]'],
  [/continues from|start date/i, "#oa-start"],
  [/period/i, "#oa-date"],
];

export function OpeningAssetsPanel({ data }: { data: OpeningAssetsData }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const calendar = useCalendar();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const live = data.assets.filter((a) => a.status !== "voided");
  const totals = live.reduce((t, a) => ({ cost: t.cost + a.cost, accumulated: t.accumulated + a.accumulated, nbv: t.nbv + a.netBookValue }), { cost: 0, accumulated: 0, nbv: 0 });
  const rec = data.reconciliation;

  async function confirmVoid() {
    const row = voiding;
    setVoiding(null);
    if (!row) return;
    const r = await voidOpeningAssetAction(row.id);
    if (!r.ok) return report(r.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--text-secondary)]">
          Assets you already owned when your books start ({formatDate(data.openingDate, calendar)}). Enter what each one cost and the depreciation already taken; depreciation carries on from the remaining life. Anything bought after that date is a purchase.
        </p>
        {data.canCreate && (
          <button type="button" onClick={() => setEditing("new")} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]">
            Add opening asset
          </button>
        )}
      </div>

      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Register against ledger</h2>
          <StatusPill tone={rec.matches ? "success" : "action"}>{rec.matches ? "Matches" : "Difference"}</StatusPill>
        </div>
        <div className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Compare title="Cost" register={rec.registerCost} ledger={rec.ledgerCost} />
          <Compare title="Accumulated depreciation" register={rec.registerAccumulated} ledger={rec.ledgerAccumulated} />
        </div>
        {!rec.matches && <p className="mt-2 text-xs text-amber-700">The asset register and the ledger&apos;s Fixed Assets accounts disagree. Look for a manual journal posted to those accounts.</p>}
      </div>

      {data.assets.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-[var(--text-secondary)]`}>No opening assets yet.</div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-left text-xs text-[var(--text-secondary)]">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Asset</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Bought</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Accumulated</th>
                <th className="px-4 py-2 text-right font-medium">Net book value</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <tr key={a.id} className={`border-b border-[var(--card-border)] last:border-0 ${a.status === "voided" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/assets/${a.id}`} className="text-[var(--color-primary)] hover:underline">
                      {a.assetCode}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{a.categoryName}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{a.purchaseDate ? formatDate(a.purchaseDate, calendar) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(a.cost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(a.accumulated)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(a.netBookValue)}</td>
                  <td className="px-4 py-2">
                    <StatusPill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</StatusPill>
                  </td>
                  <td className="relative px-2">
                    <button type="button" aria-label="Actions" onClick={() => setMenu(menu === a.id ? null : a.id)} className="rounded px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
                      ⋮
                    </button>
                    {menu === a.id && (
                      <div className="absolute right-2 top-9 z-10 w-36 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] py-1 text-sm shadow-lg">
                        <Link href={`/assets/${a.id}`} className="block px-3 py-1.5 hover:bg-[var(--surface-muted-bg)]">
                          View
                        </Link>
                        {data.canEdit && a.changeable && (
                          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[var(--surface-muted-bg)]" onClick={() => { setMenu(null); setEditing(a); }}>
                            Edit
                          </button>
                        )}
                        {data.canVoid && a.changeable && (
                          <button type="button" className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-[var(--surface-muted-bg)]" onClick={() => { setMenu(null); setVoiding(a); }}>
                            Void
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--card-border)] font-semibold">
                <td className="px-4 py-2" colSpan={4}>
                  Total ({live.length})
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{money(totals.cost)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(totals.accumulated)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(totals.nbv)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editing && <OpeningAssetModal data={data} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
      {voiding && <ConfirmDialog message={`Void opening asset ${voiding.assetCode}? Its opening entry is reversed and it is taken off the register.`} onYes={confirmVoid} onNo={() => setVoiding(null)} />}
      {dialog}
    </div>
  );
}

function Compare({ title, register, ledger }: { title: string; register: number; ledger: number }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-secondary)]">{title}</p>
      <div className="flex justify-between">
        <span className="text-[var(--text-secondary)]">Register</span>
        <span className="tabular-nums">{money(register)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-[var(--text-secondary)]">Ledger</span>
        <span className="tabular-nums">{money(ledger)}</span>
      </div>
    </div>
  );
}

function OpeningAssetModal({ data, row, onClose, onSaved }: { data: OpeningAssetsData; row: Row | null; onClose: () => void; onSaved: () => void }) {
  const { report, reportError, dialog } = useProblem();
  const f = row?.form;
  const [name, setName] = useState(f?.name ?? "");
  const [code, setCode] = useState(f?.assetCode ?? "");
  const [categoryId, setCategoryId] = useState(f?.categoryId ?? "");
  const [locationId, setLocationId] = useState(f?.locationId ?? "");
  const [description, setDescription] = useState(f?.description ?? "");
  const [boughtOn, setBoughtOn] = useState(f?.originalPurchaseDate ?? "");
  const [document, setDocument] = useState(f?.supportingDocument ?? "");
  const [cost, setCost] = useState(f ? String(f.cost) : "");
  const [accumulated, setAccumulated] = useState(f ? String(f.accumulatedDepreciation) : "");
  const [method, setMethod] = useState<Method>(f?.method ?? "straight_line");
  const [originalLife, setOriginalLife] = useState(f?.originalUsefulLifeMonths ? String(f.originalUsefulLifeMonths) : "");
  const [remainingLife, setRemainingLife] = useState(f?.remainingUsefulLifeMonths ? String(f.remainingUsefulLifeMonths) : "");
  const [residual, setResidual] = useState(f ? String(f.residualValue) : "");
  const [startDate, setStartDate] = useState(f?.depreciationStartDate || data.openingDate);
  const [saving, setSaving] = useState(false);

  const amounts = openingAssetAmounts({ cost: num(cost), accumulated: num(accumulated), residual: num(residual) });

  function chooseCategory(id: string) {
    setCategoryId(id);
    const c = data.categories.find((x) => x.id === id);
    if (!c) return;
    setMethod(c.method);
    if (c.lifeMonths && !originalLife) setOriginalLife(String(c.lifeMonths));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        name,
        description,
        categoryId,
        locationId: locationId || null,
        assetCode: code,
        originalPurchaseDate: boughtOn,
        supportingDocument: document,
        cost: num(cost),
        accumulatedDepreciation: num(accumulated),
        method,
        originalUsefulLifeMonths: method === "none" || !originalLife ? null : num(originalLife),
        remainingUsefulLifeMonths: method === "none" || !remainingLife ? null : num(remainingLife),
        residualValue: method === "none" ? 0 : num(residual),
        depreciationStartDate: method === "none" ? null : startDate || null,
      };
      const result = row ? await updateOpeningAssetAction(row.id, payload) : await createOpeningAsset(payload);
      if (!result.ok) return report(result.error, SERVER_RULES.find(([re]) => re.test(result.error))?.[1] ?? null);
      onSaved();
    } catch (e) {
      reportError(e, SERVER_RULES);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-3xl rounded-lg bg-[var(--card-bg)] p-5 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">{row ? `Edit opening asset ${row.assetCode}` : "Add opening asset"}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={label}>Asset name *</label>
            <input data-field="name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Delivery van" />
          </div>
          <div>
            <label className={label}>Asset code</label>
            <input data-field="code" className={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder={data.autoGenerateCode ? `${data.nextCode} (automatic)` : "Enter a code"} />
          </div>
          <div>
            <label className={label}>Accounting category *</label>
            <select data-field="category" className={input} value={categoryId} onChange={(e) => chooseCategory(e.target.value)}>
              <option value="">Select category</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Location</label>
            <select data-field="location" className={input} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">No location</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Original purchase date *</label>
            <DatePicker id="oa-date" max={data.openingDate} value={boughtOn} onChange={setBoughtOn} className={input} />
          </div>
          <div>
            <label className={label}>Original cost *</label>
            <input data-field="cost" type="number" min="0" step="0.01" className={input} value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div>
            <label className={label}>Accumulated depreciation at opening</label>
            <input data-field="accumulated" type="number" min="0" step="0.01" className={input} value={accumulated} onChange={(e) => setAccumulated(e.target.value)} />
          </div>
          <div>
            <label className={label}>Net book value (calculated)</label>
            <input readOnly tabIndex={-1} className={`${input} bg-gray-50`} value={money(amounts.netBookValue)} />
          </div>
          <div>
            <label className={label}>Method</label>
            <select className={input} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {Object.entries(METHOD_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          {method !== "none" && (
            <>
              <div>
                <label className={label}>Original useful life (months)</label>
                <input type="number" min="1" step="1" className={input} value={originalLife} onChange={(e) => setOriginalLife(e.target.value)} />
              </div>
              <div>
                <label className={label}>Remaining useful life (months)</label>
                <input data-field="remaining" type="number" min="0" step="1" className={input} value={remainingLife} onChange={(e) => setRemainingLife(e.target.value)} />
              </div>
              <div>
                <label className={label}>Residual value</label>
                <input data-field="residual" type="number" min="0" step="0.01" className={input} value={residual} onChange={(e) => setResidual(e.target.value)} />
              </div>
              <div>
                <label className={label}>Depreciation continues from</label>
                <DatePicker id="oa-start" value={startDate} onChange={setStartDate} className={input} />
              </div>
            </>
          )}
          <div className="sm:col-span-3">
            <label className={label}>Description</label>
            <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <label className={label}>Supporting document (reference)</label>
            <input className={input} value={document} onChange={(e) => setDocument(e.target.value)} placeholder="Link or file name" />
          </div>
        </div>
        {method !== "none" && amounts.fullyDepreciated && num(cost) > 0 && <p className="mt-3 text-xs text-[var(--text-secondary)]">Only the residual value is left, so this asset is recorded as fully depreciated.</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {saving ? "Saving..." : row ? "Save changes" : "Add opening asset"}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
