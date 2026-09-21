"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { changeInventoryOpeningDate, deleteOpeningStock, previewInventoryOpeningDate, previewOpeningStockChange, saveOpeningStock } from "./opening-actions";
import { useProblem } from "@/components/problem-dialog";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { todayIso } from "@/lib/calendar";
import { InfoDialog } from "../info-dialog";
import type { HistoryRow, OpeningDatePreview, OpeningPreview, OpeningRow } from "@/lib/inventory/opening";

type Unit = { id: string; name: string };
type ItemOption = { id: string; name: string; unitId: string | null; quantity: number; averageCost: number };

const inputCls = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm";
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ACTION_LABEL: Record<string, string> = {
  inventory_opening_created: "Opening stock added",
  inventory_opening_edited: "Opening stock edited",
  inventory_opening_deleted: "Opening stock deleted",
  inventory_opening_date_changed: "Inventory Opening Date changed",
  inventory_recosted: "History re-costed",
  inventory_recost_pending: "Re-costing pending",
  inventory_balance_rebuilt: "Balances rebuilt",
};

type Amounts = { quantity?: number; unitCost?: number; value?: number; openingDate?: string | null; costChange?: number; movementsRecosted?: number; openingBalancesMoved?: number; deleted?: boolean; problem?: string };

function describeChange(row: HistoryRow, which: "before" | "after") {
  const v = (which === "before" ? row.before : row.after) as Amounts | null;
  if (!v) return "—";
  if (row.action === "inventory_opening_date_changed") return v.openingDate ? String(v.openingDate) : "Not set";
  if (row.action === "inventory_recosted" && which === "after") return `${v.movementsRecosted ?? 0} cost${v.movementsRecosted === 1 ? "" : "s"} corrected (${fmt(v.costChange ?? 0)}); value ${fmt(v.value ?? 0)}`;
  if (v.deleted) return "Deleted";
  if (v.problem) return v.problem;
  if (v.quantity !== undefined) return `${v.quantity} × ${fmt(v.unitCost ?? (v.quantity ? (v.value ?? 0) / v.quantity : 0))} = ${fmt(v.value ?? 0)}`;
  return "—";
}

// The stock a business already held when inventory tracking began. One balance per item, all on the Inventory Opening Date.
export function OpeningPanel({ openingDate, rows, items, units, history }: { openingDate: string | null; rows: OpeningRow[]; items: ItemOption[]; units: Unit[]; history: HistoryRow[] }) {
  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units]);
  const totalQuantity = rows.reduce((s, r) => s + r.quantity, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">Opening stock represents inventory held by the organisation at the beginning of inventory tracking.</div>

      <OpeningDateCard openingDate={openingDate} />

      <div className="grid grid-cols-3 gap-3">
        {[
          ["Total products", String(rows.length)],
          ["Total opening quantity", String(Math.round(totalQuantity * 1000) / 1000)],
          ["Total opening inventory value", fmt(totalValue)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <SavedRows rows={rows} unitName={unitName} disabled={!openingDate} />
      <AddProducts items={items.filter((i) => !rows.some((r) => r.itemId === i.id))} units={units} disabled={!openingDate} />
      <History history={history} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- opening date

function OpeningDateCard({ openingDate }: { openingDate: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <p className="text-xs text-gray-500">Inventory Opening Date</p>
        <p className="text-lg font-semibold text-gray-900">{openingDate ? <D value={openingDate} /> : "Not set"}</p>
        <p className="text-xs text-gray-500">
          {openingDate ? "Inventory history begins on this date. Nothing that moves stock can be dated before it." : "Set the date inventory tracking begins before entering opening stock."}
        </p>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
        {openingDate ? "Change date" : "Set date"}
      </button>
      {open && <OpeningDateModal current={openingDate} onClose={() => setOpen(false)} />}
    </div>
  );
}

const IMPACT_AREAS = ["Opening stock", "Inventory quantity", "Inventory valuation", "Cost of goods sold", "Gross profit", "Subsequent stock balances", "Related accounting balances"];

function OpeningDateModal({ current, onClose }: { current: string | null; onClose: () => void }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [date, setDate] = useState(current ?? "");
  const [preview, setPreview] = useState<OpeningDatePreview | null>(null);
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pick(value: string) {
    setDate(value);
    setReviewed(false);
    setPreview(null);
    if (!value) return;
    try {
      setPreview(await previewInventoryOpeningDate(value));
    } catch (e) {
      report(e instanceof Error ? e.message : "Couldn't check that date", null);
    }
  }

  async function confirm() {
    if (!date) return report("Choose the Inventory Opening Date.", null);
    setSaving(true);
    try {
      await changeInventoryOpeningDate({ date, reason, confirmed: true });
      router.refresh();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  const blocked = (preview?.blockerCount ?? 0) > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-lg">
        <h2 className="text-base font-semibold text-gray-900">{current ? "Change the Inventory Opening Date" : "Set the Inventory Opening Date"}</h2>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Inventory Opening Date</label>
          <DatePicker max={todayIso()} value={date} onChange={pick} className={inputCls} />
        </div>

        {preview && (
          <div className="space-y-3 text-sm">
            {blocked ? (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-red-800">
                <p className="font-medium">{preview.blockerCount} stock movement{preview.blockerCount === 1 ? " is" : "s are"} dated before this date.</p>
                <p className="text-xs">They would fall outside the inventory history. Correct them, or choose an earlier date.</p>
                <ul className="mt-2 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
                  {preview.blockers.map((b, i) => (
                    <li key={i}>
                      <D value={b.date} /> — {b.document} ({b.item})
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <p>
                    {preview.openingRows} opening balance{preview.openingRows === 1 ? "" : "s"} worth {fmt(preview.openingValue)}
                    {preview.rowsMoved > 0 ? `; ${preview.rowsMoved} would move to this date, with their journal entries.` : " — none need to move."}
                  </p>
                  <p>{preview.documentsAfter} stock movement{preview.documentsAfter === 1 ? "" : "s"} on or after this date stay as they are.</p>
                </div>
                <div className="text-xs text-gray-600">
                  <p className="mb-1 font-medium text-gray-800">Changing the opening date may affect:</p>
                  <ul className="grid grid-cols-2 list-disc gap-x-4 pl-5">
                    {IMPACT_AREAS.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Reason (optional)</label>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
                </div>
                <label className="flex items-start gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5" />I have reviewed the impact and want to change the Inventory Opening Date.
                </label>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={saving || !preview || blocked || !reviewed} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {saving ? "Saving..." : "Confirm"}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- saved opening balances

function SavedRows({ rows, unitName, disabled }: { rows: OpeningRow[]; unitName: Map<string, string>; disabled: boolean }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [review, setReview] = useState<{ kind: "edit" | "delete"; row: OpeningRow; preview: OpeningPreview; quantity: number; unitCost: number } | null>(null);

  function startEdit(r: OpeningRow) {
    setEditingId(r.itemId);
    setQuantity(String(r.quantity));
    setUnitCost(String(r.unitCost));
  }

  async function reviewEdit(r: OpeningRow) {
    const q = parseFloat(quantity);
    const c = parseFloat(unitCost);
    if (!(q > 0)) return report("Enter a quantity greater than zero.", null);
    if (!(c >= 0)) return report("Enter the cost per unit.", null);
    try {
      setReview({ kind: "edit", row: r, preview: await previewOpeningStockChange({ itemId: r.itemId, quantity: q, unitCost: c }), quantity: q, unitCost: c });
    } catch (e) {
      report(e instanceof Error ? e.message : "Couldn't check that change", null);
    }
  }

  async function reviewDelete(r: OpeningRow) {
    try {
      setReview({ kind: "delete", row: r, preview: await previewOpeningStockChange({ itemId: r.itemId, quantity: null }), quantity: 0, unitCost: 0 });
    } catch (e) {
      report(e instanceof Error ? e.message : "Couldn't check that change", null);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">Opening balances</h3>
      <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 font-medium">Unit</th>
            <th className="px-4 py-2 text-right font-medium">Quantity</th>
            <th className="px-4 py-2 text-right font-medium">Unit cost</th>
            <th className="px-4 py-2 text-right font-medium">Total value</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const editing = editingId === r.itemId;
            const q = parseFloat(quantity) || 0;
            const c = parseFloat(unitCost) || 0;
            return (
              <tr key={r.itemId} className="border-t border-gray-100">
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 text-gray-500">{unitName.get(r.unitId ?? "") ?? "—"}</td>
                {editing ? (
                  <>
                    <td className="px-4 py-1 text-right"><input type="number" step="0.001" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-24 rounded border border-gray-300 px-1.5 py-1 text-right text-sm" /></td>
                    <td className="px-4 py-1 text-right"><input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="w-24 rounded border border-gray-300 px-1.5 py-1 text-right text-sm" /></td>
                    <td className="px-4 py-2 text-right">{fmt(q * c)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => reviewEdit(r)} className="text-xs text-gray-700 hover:underline">Review &amp; save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="ml-3 text-xs text-gray-500 hover:underline">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2 text-right">{r.quantity}</td>
                    <td className="px-4 py-2 text-right">{fmt(r.unitCost)}</td>
                    <td className="px-4 py-2 text-right">{fmt(r.value)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button type="button" disabled={disabled} onClick={() => startEdit(r)} className="text-xs text-gray-600 hover:underline disabled:opacity-40">Edit</button>
                      <button type="button" disabled={disabled} onClick={() => reviewDelete(r)} className="ml-3 text-xs text-red-600 hover:underline disabled:opacity-40">Delete</button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No opening stock yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {review && (
        <ImpactDialog
          review={review}
          onClose={() => setReview(null)}
          onDone={() => {
            setReview(null);
            setEditingId(null);
            router.refresh();
          }}
        />
      )}
      {dialog}
    </section>
  );
}

// What an edit or deletion would change — shown before it happens, and confirmed with an optional reason.
function ImpactDialog({ review, onClose, onDone }: { review: { kind: "edit" | "delete"; row: OpeningRow; preview: OpeningPreview; quantity: number; unitCost: number }; onClose: () => void; onDone: () => void }) {
  const { report, dialog } = useProblem();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { preview, kind, row } = review;

  async function confirm() {
    setSaving(true);
    try {
      if (kind === "edit") await saveOpeningStock({ itemId: row.itemId, quantity: review.quantity, unitCost: review.unitCost, reason });
      else await deleteOpeningStock({ itemId: row.itemId, reason });
      onDone();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg space-y-3 rounded-lg bg-white p-5 shadow-lg">
        <h2 className="text-base font-semibold text-gray-900">{kind === "edit" ? "Review the change to" : "Delete the opening stock of"} {row.name}</h2>
        {preview.before && (
          <p className="text-sm text-gray-700">
            Now: {preview.before.quantity} × {fmt(preview.before.unitCost)} = {fmt(preview.before.value)}
            {preview.after ? <> &rarr; <b>{preview.after.quantity} × {fmt(preview.after.unitCost)} = {fmt(preview.after.value)}</b></> : <> &rarr; <b>removed</b></>}
          </p>
        )}
        <p className="text-xs text-gray-600">
          Stock on hand: {preview.stock.quantityBefore} → {preview.stock.quantityAfter} · stock value: {fmt(preview.stock.valueBefore)} → {fmt(preview.stock.valueAfter)}
        </p>
        {preview.blocked ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{preview.blocked}</div>
        ) : preview.affected.length > 0 ? (
          <div className="text-xs text-gray-700">
            <p className="mb-1 font-medium text-gray-900">
              {preview.affected.length} later cost{preview.affected.length === 1 ? "" : "s"} will be re-costed
              {preview.costOfGoodsSoldChange !== 0 ? ` (cost of goods sold ${preview.costOfGoodsSoldChange > 0 ? "up" : "down"} by ${fmt(Math.abs(preview.costOfGoodsSoldChange))})` : ""}. A correcting entry is posted today; earlier entries are not rewritten.
            </p>
            <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5">
              {preview.affected.map((a, i) => (
                <li key={i}>
                  {a.document} (<D value={a.date} />): {fmt(a.from)} → {fmt(a.to)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-gray-600">No later documents are affected.</p>
        )}
        <div>
          <label className="mb-1 block text-xs text-gray-500">Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Counted wrongly at the start" className={inputCls} />
        </div>
        <p className="text-xs text-gray-500">The original is kept in the history below with the old and new values and who changed it.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="button" onClick={confirm} disabled={saving || Boolean(preview.blocked)} className={`rounded px-4 py-1.5 text-sm text-white disabled:opacity-50 ${kind === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]"}`}>
            {saving ? "Saving..." : kind === "edit" ? "Confirm change" : "Delete"}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------ add products

type Staged = { itemId: string; name: string; unit: string; quantity: number; unitCost: number };

function AddProducts({ items, units, disabled }: { items: ItemOption[]; units: Unit[]; disabled: boolean }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [unitId, setUnitId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const available = items.filter((i) => !staged.some((s) => s.itemId === i.id) && (!unitId || i.unitId === unitId));
  const total = (parseFloat(quantity) || 0) * (parseFloat(unitCost) || 0);

  function handleItem(value: string) {
    setItemId(value);
    const chosen = items.find((i) => i.id === value);
    if (chosen?.unitId) setUnitId(chosen.unitId);
  }

  function add() {
    const item = items.find((i) => i.id === itemId);
    const q = parseFloat(quantity);
    const c = parseFloat(unitCost);
    if (!item) return report("Select the product.", '[data-field="item"]');
    if (!(q > 0)) return report("Enter a quantity greater than zero.", '[data-field="quantity"]');
    if (!(c >= 0)) return report("Enter the cost per unit.", '[data-field="cost"]');
    setStaged((s) => [...s, { itemId: item.id, name: item.name, unit: units.find((u) => u.id === item.unitId)?.name ?? "", quantity: q, unitCost: c }]);
    setItemId("");
    setQuantity("");
    setUnitCost("");
  }

  async function saveAll() {
    if (staged.length === 0) return report("Add at least one product first.", null);
    setSaving(true);
    let done = 0;
    try {
      for (const s of staged) {
        await saveOpeningStock({ itemId: s.itemId, quantity: s.quantity, unitCost: s.unitCost });
        done++;
      }
      setSaved(`Opening stock for ${done} product${done === 1 ? "" : "s"} has been recorded`);
      setStaged([]);
    } catch (e) {
      setStaged((list) => list.slice(done));
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
      router.refresh();
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Add products</h3>
      {disabled && <p className="text-xs text-amber-700">Set the Inventory Opening Date first — opening stock belongs to that date.</p>}
      <div className="grid grid-cols-6 items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Unit</label>
          <select value={unitId} disabled={disabled} onChange={(e) => { setUnitId(e.target.value); setItemId(""); }} className={inputCls}>
            <option value="">All units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-gray-500">Product</label>
          <select data-field="item" value={itemId} disabled={disabled} onChange={(e) => handleItem(e.target.value)} className={inputCls}>
            <option value="">Search / select product</option>
            {available.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Quantity</label>
          <input data-field="quantity" type="number" step="0.001" min="0" value={quantity} disabled={disabled} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Unit cost</label>
          <input data-field="cost" type="number" step="0.01" min="0" value={unitCost} disabled={disabled} onChange={(e) => setUnitCost(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Total value</label>
          <input readOnly value={fmt(total)} className={`${inputCls} bg-gray-50 text-gray-700`} />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={add} disabled={disabled} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">+ Add product</button>
      </div>

      {staged.length > 0 && (
        <>
          <table className="w-full overflow-hidden rounded-lg border border-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Product</th>
                <th className="px-3 py-1.5 text-right font-medium">Quantity</th>
                <th className="px-3 py-1.5 text-right font-medium">Unit cost</th>
                <th className="px-3 py-1.5 text-right font-medium">Total value</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {staged.map((s) => (
                <tr key={s.itemId} className="border-t border-gray-100">
                  <td className="px-3 py-1.5">{s.name}{s.unit ? <span className="text-gray-400"> · {s.unit}</span> : null}</td>
                  <td className="px-3 py-1.5 text-right">{s.quantity}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(s.unitCost)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(s.quantity * s.unitCost)}</td>
                  <td className="px-3 py-1.5 text-right"><button type="button" onClick={() => setStaged((l) => l.filter((x) => x.itemId !== s.itemId))} className="text-xs text-red-600 hover:underline">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end">
            <button type="button" onClick={saveAll} disabled={saving} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">{saving ? "Saving..." : "Save opening stock"}</button>
          </div>
        </>
      )}
      {dialog}
      {saved && <InfoDialog message={saved} onOk={() => setSaved(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- history

function History({ history }: { history: HistoryRow[] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">Opening stock history</h3>
      <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">Date / time</th>
            <th className="px-3 py-2 font-medium">User</th>
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Previous</th>
            <th className="px-3 py-2 font-medium">New</th>
            <th className="px-3 py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-t border-gray-100 align-top">
              <td className="px-3 py-2 whitespace-nowrap text-gray-600">{new Date(h.when).toLocaleString()}</td>
              <td className="px-3 py-2">{h.user}</td>
              <td className="px-3 py-2">{ACTION_LABEL[h.action] ?? h.action}</td>
              <td className="px-3 py-2">{h.itemName ?? "—"}</td>
              <td className="px-3 py-2 text-gray-600">{describeChange(h, "before")}</td>
              <td className="px-3 py-2 text-gray-600">{describeChange(h, "after")}</td>
              <td className="px-3 py-2 text-gray-500">{h.reason ?? "—"}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">No history yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
