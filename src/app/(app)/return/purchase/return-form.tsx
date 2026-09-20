"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect, ItemSelect } from "@/components/quick-add/pickers";
import { createPurchaseReturn } from "./actions";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Vendor = { id: string; name: string };
type Item = { id: string; name: string; purchasePrice: string };

type LineRow = {
  itemId: string;
  description: string;
  rate: string;
  quantity: string;
  discount: string;
};

const MIN_LINES = 4;
const fmt = (n: number) => n.toFixed(2);
const today = () => todayIso();
const emptyLine = (): LineRow => ({ itemId: "", description: "", rate: "", quantity: "", discount: "0" });

function computeLine(line: LineRow, vatRate: number) {
  const rate = parseFloat(line.rate) || 0;
  const quantity = parseFloat(line.quantity) || 0;
  const discount = parseFloat(line.discount) || 0;
  const gross = rate * quantity;
  const taxable = Math.max(gross - discount, 0);
  const vat = taxable * (vatRate / 100);
  const total = taxable + vat;
  return { gross, taxable, vat, total };
}

function isLineComplete(line: LineRow) {
  return Boolean((parseFloat(line.rate) || 0) > 0 && (parseFloat(line.quantity) || 0) > 0);
}

function isLineTouched(line: LineRow) {
  return Boolean(line.itemId || line.description.trim() || line.rate || (parseFloat(line.quantity) || 0) > 0);
}

type FieldErrors = { noteNumber?: string; date?: string; vendorId?: string; items?: string };

const inputCls =
  "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const inputErrCls =
  "w-full rounded border border-red-400 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400";
const cellInputCls =
  "rounded border border-gray-300 bg-white px-1.5 py-1 text-sm text-center focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const calculatedCellCls = "rounded bg-gray-50 px-1.5 py-1 text-sm text-center text-gray-600";

// The credit note form: the single invoice format (header, item lines, summary, Save) for a purchase return.
export function PurchaseReturnForm({
  vendors: vendorsProp,
  items: itemsProp,
  vatRate,
  onDirtyChange,
}: {
  vendors: Vendor[];
  items: Item[];
  vatRate: number;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  // Options plus anything just created with "Add new" (the server list catches up after a refresh).
  const [vendors, addVendor] = useWithAdded(vendorsProp);
  const [items, addItem] = useWithAdded(itemsProp);
  const [noteDate, setNoteDate] = useState(today());
  const [noteNumber, setNoteNumber] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [lines, setLines] = useState<LineRow[]>(() => Array.from({ length: MIN_LINES }, emptyLine));
  const [withVat, setWithVat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!onDirtyChange) return;
    const dirty = Boolean(noteNumber.trim() || vendorId || lines.some(isLineTouched));
    onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteNumber, vendorId, lines]);

  function updateLine(i: number, field: keyof LineRow, value: string, known?: Item) {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        if (field === "itemId") {
          const item = known ?? items.find((it) => it.id === value);
          return {
            ...l,
            itemId: value,
            description: item ? item.name : l.description,
            rate: item ? item.purchasePrice : l.rate,
          };
        }
        return { ...l, [field]: value };
      })
    );
  }

  function handleAddLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function handleDeleteLine(i: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  const computedLines = lines.map((l) => computeLine(l, withVat ? vatRate : 0));
  const grandGross = computedLines.reduce((s, c) => s + c.gross, 0);
  const grandTaxable = computedLines.reduce((s, c) => s + c.taxable, 0);
  const grandVat = computedLines.reduce((s, c) => s + c.vat, 0);
  const grandTotal = computedLines.reduce((s, c) => s + c.total, 0);
  const grandDiscount = lines.reduce((s, l) => s + (parseFloat(l.discount) || 0), 0);

  async function performSave() {
    const errors: FieldErrors = {};
    if (!noteNumber.trim()) errors.noteNumber = "Credit note number is required.";
    if (!noteDate) errors.date = "Please enter the date.";
    if (!vendorId) errors.vendorId = "Please select a supplier.";
    if (!lines.some(isLineComplete)) errors.items = "Add at least one item line with a valid rate and quantity.";
    setFieldErrors(errors);
    setSaveError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      await createPurchaseReturn({
        noteNumber: noteNumber.trim(),
        noteDate,
        vendorId,
        withVat,
        lines: lines.filter(isLineComplete).map((l) => ({
          itemId: l.itemId || null,
          description: l.description.trim(),
          rate: parseFloat(l.rate) || 0,
          quantity: parseFloat(l.quantity) || 0,
          discount: parseFloat(l.discount) || 0,
        })),
      });

      setNoteDate(today());
      setNoteNumber("");
      setVendorId("");
      setLines(Array.from({ length: MIN_LINES }, emptyLine));
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2500);
      onDirtyChange?.(false);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Debit Note Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <DatePicker max={today()} value={noteDate} onChange={(v) => {
                setNoteDate(v);
                if (fieldErrors.date) setFieldErrors((p) => ({ ...p, date: undefined }));
              }} className={fieldErrors.date ? inputErrCls : inputCls} />
            {fieldErrors.date && <p className="mt-1 text-xs text-red-600">{fieldErrors.date}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Debit Note Number</label>
            <input
              value={noteNumber}
              onChange={(e) => {
                setNoteNumber(e.target.value);
                if (fieldErrors.noteNumber) setFieldErrors((p) => ({ ...p, noteNumber: undefined }));
              }}
              className={fieldErrors.noteNumber ? inputErrCls : inputCls}
            />
            {fieldErrors.noteNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.noteNumber}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Supplier</label>
            <SupplierSelect
              value={vendorId}
              options={vendors}
              onChange={(id) => {
                setVendorId(id);
                if (fieldErrors.vendorId) setFieldErrors((p) => ({ ...p, vendorId: undefined }));
              }}
              onAdded={addVendor}
              className={fieldErrors.vendorId ? inputErrCls : inputCls}
            />
            {fieldErrors.vendorId && <p className="mt-1 text-xs text-red-600">{fieldErrors.vendorId}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Original bill</label>
            <select value={withVat ? "vat" : "none"} onChange={(e) => setWithVat(e.target.value === "vat")} className={inputCls}>
              <option value="none">Without VAT</option>
              <option value="vat">VAT bill</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Returned Items</h2>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-center text-gray-500">
              <tr>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Item</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Rate</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Qty</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Gross</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Discount</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Taxable</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">VAT</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Total</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const c = computedLines[i];
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-1 py-1 text-center">
                      <ItemSelect
                        value={line.itemId}
                        options={items}
                        placeholder="Custom"
                        onChange={(id) => updateLine(i, "itemId", id)}
                        onAdded={(it) => {
                          const item = { id: it.id, name: it.name, purchasePrice: it.purchasePrice };
                          addItem(item);
                          updateLine(i, "itemId", it.id, item);
                        }}
                        className="w-48 rounded border border-gray-300 bg-white px-1.5 py-1 text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.rate}
                        onChange={(e) => updateLine(i, "rate", e.target.value)}
                        className={`w-20 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        className={`w-16 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-20 ${calculatedCellCls}`}>{fmt(c.gross)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discount}
                        onChange={(e) => updateLine(i, "discount", e.target.value)}
                        className={`w-20 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-20 ${calculatedCellCls}`}>{fmt(c.taxable)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-20 ${calculatedCellCls}`}>{fmt(c.vat)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-20 rounded bg-gray-50 px-1.5 py-1 text-sm text-center font-medium text-gray-900`}>
                        {fmt(c.total)}
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => handleDeleteLine(i)}
                        className="text-xs text-gray-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button type="button" onClick={handleAddLine} className="mt-2 text-sm text-gray-600 hover:text-gray-900">
          + Add Item
        </button>
        {fieldErrors.items && <p className="mt-1 text-xs text-red-600">{fieldErrors.items}</p>}
      </section>

      <div className="flex flex-wrap gap-4">
        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Debit Note Summary</h2>
          <div className="space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Gross</span>
              <span>{fmt(grandGross)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Discount</span>
              <span>{fmt(grandDiscount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Taxable</span>
              <span>{fmt(grandTaxable)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">VAT</span>
              <span>{fmt(grandVat)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Total</span>
              <span className="text-base font-bold text-gray-900">{fmt(grandTotal)}</span>
            </div>
          </div>
        </section>
        <p className="max-w-md self-end text-xs text-gray-500">
          Posts to the Chart of Accounts: the supplier's payable account (debit), Inventory 1200 and Tax Receivable 1300 (credit). Stock is reduced.
        </p>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        {savedMessage && <span className="text-xs text-green-600">Saved</span>}
        <button
          type="button"
          onClick={performSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

    </div>
  );
}
