"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adjustStock } from "./actions";
import { useProblem } from "@/components/problem-dialog";
import { DatePicker } from "@/components/calendar/date-picker";
import { useOpeningDateGuard } from "@/components/inventory/opening-date";
import { todayIso } from "@/lib/calendar";
import { InfoDialog } from "../info-dialog";
import { OpeningPanel } from "./opening-panel";
import type { HistoryRow, OpeningRow } from "@/lib/inventory/opening";

type Unit = { id: string; name: string };
type ItemOption = { id: string; name: string; unitId: string | null; quantity: number; averageCost: number };

const TABS = [
  { id: "stock", label: "Stock" },
  { id: "opening", label: "Opening stock" },
  { id: "adjust", label: "Adjust stock" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const inputCls = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm";

// The Stock page: what is on hand (the report, rendered on the server and passed in), the opening balances the books started
// with, and corrections after a count.
export function StockTabs({
  items,
  units,
  report,
  openingDate,
  openingRows,
  history,
  initialTab,
}: {
  items: ItemOption[];
  units: Unit[];
  report: React.ReactNode;
  openingDate: string | null;
  openingRows: OpeningRow[];
  history: HistoryRow[];
  initialTab?: string;
}) {
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initialTab) ? (initialTab as TabId) : "stock");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${tab === t.id ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stock" && report}
      {tab === "opening" && <OpeningPanel openingDate={openingDate} rows={openingRows} items={items} units={units} history={history} />}
      {tab === "adjust" && <AdjustForm items={items} units={units} />}
    </div>
  );
}

function AdjustForm({ items, units }: { items: ItemOption[]; units: Unit[] }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [unitId, setUnitId] = useState("");
  const [itemId, setItemId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const { guard, notice } = useOpeningDateGuard(date, true);

  // Choosing a unit narrows the items to those counted in it; choosing an item fills in its unit.
  const itemsInUnit = useMemo(() => (unitId ? items.filter((i) => i.unitId === unitId) : items), [items, unitId]);
  const item = items.find((i) => i.id === itemId);
  const unitName = units.find((u) => u.id === (item?.unitId ?? unitId))?.name;

  function handleUnitChange(value: string) {
    setUnitId(value);
    if (item && value && item.unitId !== value) setItemId("");
  }

  function handleItemChange(value: string) {
    setItemId(value);
    const chosen = items.find((i) => i.id === value);
    if (chosen?.unitId) setUnitId(chosen.unitId);
  }

  async function save() {
    const qty = parseFloat(quantity);
    if (!itemId) return report("Select the item.", '[data-field="item"]');
    if (!(qty > 0)) return report("Enter a quantity greater than zero.", '[data-field="quantity"]');
    if (!reason.trim()) return report("Give the reason for this adjustment.", '[data-field="reason"]');
    if (!guard()) return;
    setSaving(true);
    try {
      await adjustStock({ itemId, quantityChange: direction === "in" ? qty : -qty, unitCost: direction === "in" && unitCost !== "" ? parseFloat(unitCost) : null, date, reason });
      setSavedMessage(`The stock adjustment for ${item?.name ?? "the item"} has been recorded`);
      setItemId("");
      setQuantity("");
      setUnitCost("");
      setReason("");
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-xs text-gray-500">Correct stock after a count — damage, theft or a difference. Taking stock out is valued at the average cost; the difference goes to Inventory Adjustments.</p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Unit</label>
          <select value={unitId} onChange={(e) => handleUnitChange(e.target.value)} className={inputCls}>
            <option value="">All units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Item</label>
          <select data-field="item" value={itemId} onChange={(e) => handleItemChange(e.target.value)} className={inputCls}>
            <option value="">Select item</option>
            {itemsInUnit.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        {item && (
          <p className="col-span-2 -mt-2 text-xs text-gray-500">
            On hand {item.quantity}
            {unitName ? ` ${unitName}` : ""} · average cost {item.averageCost.toFixed(2)}
          </p>
        )}

        <div>
          <label className="mb-1 block text-xs text-gray-500">Date</label>
          <DatePicker max={todayIso()} value={date} onChange={setDate} className={inputCls} />
          {notice}
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Adjustment</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")} className={inputCls}>
            <option value="out">Take out (loss)</option>
            <option value="in">Put in (gain)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Quantity{unitName ? ` (${unitName})` : ""}</label>
          <input data-field="quantity" type="number" step="0.001" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
        </div>
        {direction === "in" && (
          <div>
            <label className="mb-1 block text-xs text-gray-500">Cost per unit (optional)</label>
            <input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder={item ? `Average ${item.averageCost.toFixed(2)}` : ""} className={inputCls} />
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-500">Reason</label>
        <input data-field="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged in storage, stock count difference" className={inputCls} />
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
          {saving ? "Saving..." : "Save adjustment"}
        </button>
      </div>

      {dialog}
      {savedMessage && <InfoDialog message={savedMessage} onOk={() => setSavedMessage(null)} />}
    </div>
  );
}
