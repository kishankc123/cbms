"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect } from "@/components/quick-add/pickers";
import { BillAvailableToggle } from "@/components/bill-available-toggle";
import { useProblem } from "@/components/problem-dialog";
import { createCashPurchase, updateCashPurchase, type CashBillType } from "./actions";
import { InfoDialog } from "../inventory/info-dialog";
import { RecordPayModal } from "./record-pay-modal";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number };

type LineRow = {
  description: string;
  categoryId: string;
  rate: string;
  quantity: string;
  discount: string;
};

export const BILL_TYPE_OPTIONS: { value: CashBillType; label: string }[] = [
  { value: "no_bill", label: "No bill" },
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "estimate", label: "Estimate" },
  { value: "challan", label: "Challan" },
];

const MIN_LINES = 4;
const fmt = (n: number) => n.toFixed(2);
const today = () => todayIso();
const emptyLine = (): LineRow => ({ description: "", categoryId: "", rate: "", quantity: "", discount: "0" });
const cell = (row: number, col: string) => `[data-row="${row}"][data-col="${col}"]`;

// VAT only applies when the bill type is VAT — any other bill type books the taxable amount with no VAT.
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

const hasAmounts = (line: LineRow) => (parseFloat(line.rate) || 0) > 0 && (parseFloat(line.quantity) || 0) > 0;
const isLineComplete = (line: LineRow) => Boolean(line.categoryId && hasAmounts(line));
const isLineTouched = (line: LineRow) => Boolean(line.description.trim() || line.categoryId || line.rate || (parseFloat(line.quantity) || 0) > 0);

export type InitialConsumableBill = {
  billId: string;
  billNumber: string;
  billDate: string;
  vendorId: string;
  billType: CashBillType;
  billAvailable?: boolean | null;
  lines: { description: string; categoryId: string; rate: number; quantity: number; discount: number }[];
  payments: PaymentLine[];
};

const inputCls =
  "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const inputErrCls = "w-full rounded border border-red-400 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400";
const cellInputCls =
  "rounded border border-gray-300 bg-white px-1.5 py-1 text-sm text-center focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const calculatedCellCls = "rounded bg-gray-50 px-1.5 py-1 text-sm text-center text-gray-600";

// Same shape as the Stockable purchase invoice form (header, lines, summary, Record Pay + Save) for one
// consumable bill: no item picker, the line's description is typed instead, and each line is booked to a
// purchase category. Consumables are paid for in full when they are bought.
export function ConsumablePurchaseForm({
  vendors: vendorsProp,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  initial,
  onDone,
  onDirtyChange,
}: {
  vendors: Vendor[];
  categoryAccounts: Account[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  initial?: InitialConsumableBill;
  onDone?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [vendors, addVendor] = useWithAdded(vendorsProp);
  const [billDate, setBillDate] = useState(initial?.billDate ?? today());
  const [billNumber, setBillNumber] = useState(initial?.billNumber ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [billType, setBillType] = useState<CashBillType>(initial?.billType ?? "no_bill");
  const [billAvailable, setBillAvailable] = useState(initial?.billAvailable ?? true);
  const [lines, setLines] = useState<LineRow[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((l) => ({ description: l.description, categoryId: l.categoryId, rate: String(l.rate), quantity: String(l.quantity), discount: String(l.discount) }))
      : Array.from({ length: MIN_LINES }, emptyLine)
  );
  const [payments, setPayments] = useState<PaymentLine[]>(initial?.payments ?? []);
  const [showPayment, setShowPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSavedDialog, setShowSavedDialog] = useState(false);
  const [badFields, setBadFields] = useState<Set<string>>(new Set());
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { report, dialog } = useProblem();

  useEffect(() => {
    if (!showPayment) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPayment(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPayment]);

  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(Boolean(billNumber.trim() || vendorId || payments.length > 0 || lines.some(isLineTouched) || (initial && billDate !== initial.billDate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billNumber, vendorId, payments, lines]);

  function updateLine(i: number, field: keyof LineRow, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }
  const handleAddLine = () => setLines((prev) => [...prev, emptyLine()]);
  const handleDeleteLine = (i: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const effectiveVatRate = billType === "vat" ? vatRate : 0;
  const computedLines = lines.map((l) => computeLine(l, effectiveVatRate));
  const grandGross = computedLines.reduce((s, c) => s + c.gross, 0);
  const grandTaxable = computedLines.reduce((s, c) => s + c.taxable, 0);
  const grandVat = computedLines.reduce((s, c) => s + c.vat, 0);
  const grandTotal = computedLines.reduce((s, c) => s + c.total, 0);
  const grandDiscount = lines.reduce((s, l) => s + (parseFloat(l.discount) || 0), 0);
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(grandTotal - paidTotal, 0);
  const paymentStatus = paidTotal <= 0 ? "Unpaid" : remaining <= 0.005 ? "Paid" : "Partially paid";

  const bad = (k: string) => badFields.has(k);

  async function performSave() {
    // The first thing that needs attention, in the order it appears on the page.
    let problem: { message: string; target: string; field: string } | null = null;
    const incomplete = lines.findIndex((l) => isLineTouched(l) && !isLineComplete(l));
    if (!billDate) problem = { message: "Please enter the bill date.", target: "#cp-date", field: "date" };
    else if (incomplete >= 0) {
      const l = lines[incomplete];
      if (!l.categoryId) problem = { message: `Line ${incomplete + 1}: select a category. Finish or clear the line before saving.`, target: cell(incomplete, "category"), field: `cat${incomplete}` };
      else if (!(parseFloat(l.rate) > 0)) problem = { message: `Line ${incomplete + 1}: enter the rate. Finish or clear the line before saving.`, target: cell(incomplete, "rate"), field: `rate${incomplete}` };
      else problem = { message: `Line ${incomplete + 1}: enter the quantity. Finish or clear the line before saving.`, target: cell(incomplete, "qty"), field: `qty${incomplete}` };
    } else if (!lines.some(isLineComplete)) problem = { message: "Add at least one line with a category, rate and quantity.", target: cell(0, "category"), field: "cat0" };
    else if (payments.length === 0) problem = { message: "Record the payment: a consumable purchase is paid for in full when it is bought.", target: '[data-field="pay"]', field: "" };
    else if (Math.abs(paidTotal - grandTotal) > 0.004) {
      problem = { message: `The recorded payments (${fmt(paidTotal)}) must equal the bill total (${fmt(grandTotal)}). Edit the payment.`, target: '[data-field="pay"]', field: "" };
    }
    setBadFields(problem?.field ? new Set([problem.field]) : new Set());
    if (problem) return report(problem.message, problem.target);

    setSaving(true);
    try {
      const payload = {
        billNumber: billNumber.trim(),
        billDate,
        vendorId,
        billType,
        billAvailable,
        lines: lines.filter(isLineComplete).map((l) => ({
          description: l.description.trim(),
          categoryId: l.categoryId,
          rate: parseFloat(l.rate) || 0,
          quantity: parseFloat(l.quantity) || 0,
          discount: parseFloat(l.discount) || 0,
        })),
        payments,
      };
      if (initial) await updateCashPurchase({ ...payload, billId: initial.billId });
      else await createCashPurchase(payload);

      if (onDone) {
        onDone();
      } else {
        setBillDate(today());
        setBillNumber("");
        setVendorId("");
        setBillType("no_bill");
        setBillAvailable(true);
        setLines(Array.from({ length: MIN_LINES }, emptyLine));
        setPayments([]);
        setShowSavedDialog(true);
      }
      onDirtyChange?.(false);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save";
      const rules: [RegExp, string][] = [
        [/closed period|bill date/i, "#cp-date"],
        [/already recorded|bill number/i, '[data-field="billNumber"]'],
        [/category/i, cell(0, "category")],
        [/supplier/i, '[data-field="supplier"]'],
        [/payment|Cash or Bank/i, '[data-field="pay"]'],
        [/line/i, cell(0, "rate")],
      ];
      report(message, rules.find(([re]) => re.test(message))?.[1] ?? null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Purchase Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <DatePicker
              id="cp-date"
              max={today()}
              value={billDate}
              onChange={(v) => {
                setBillDate(v);
                setBadFields((p) => new Set([...p].filter((k) => k !== "date")));
              }}
              className={bad("date") ? inputErrCls : inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bill Number (optional)</label>
            <input data-field="billNumber" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Supplier (optional)</label>
            <div data-field="supplier" data-opens>
              <SupplierSelect value={vendorId} options={vendors} onChange={setVendorId} onAdded={addVendor} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bill Type</label>
            <select value={billType} onChange={(e) => setBillType(e.target.value as CashBillType)} className={inputCls}>
              {BILL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <BillAvailableToggle value={billAvailable} onChange={setBillAvailable} />
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Purchase Items</h2>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-center text-gray-500">
              <tr>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Description</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Category</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Rate</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Qty</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Gross</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Discount</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Taxable</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">VAT</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Total</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const c = computedLines[i];
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-1 py-1 text-center">
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                        placeholder="Details"
                        className={`w-[206px] ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <select
                        data-row={i}
                        data-col="category"
                        value={line.categoryId}
                        onChange={(e) => {
                          updateLine(i, "categoryId", e.target.value);
                          setBadFields((p) => new Set([...p].filter((k) => k !== `cat${i}`)));
                        }}
                        className={`w-[190px] ${cellInputCls} ${bad(`cat${i}`) ? "border-red-400" : ""}`}
                      >
                        <option value="">Select category</option>
                        {categoryAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        data-row={i}
                        data-col="rate"
                        value={line.rate}
                        onChange={(e) => updateLine(i, "rate", e.target.value)}
                        className={`w-[95px] ${cellInputCls} ${bad(`rate${i}`) ? "border-red-400" : ""}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        data-row={i}
                        data-col="qty"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        className={`w-[79px] ${cellInputCls} ${bad(`qty${i}`) ? "border-red-400" : ""}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-[95px] ${calculatedCellCls}`}>{fmt(c.gross)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discount}
                        onChange={(e) => updateLine(i, "discount", e.target.value)}
                        className={`w-[95px] ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-[95px] ${calculatedCellCls}`}>{fmt(c.taxable)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-[95px] ${calculatedCellCls}`}>{fmt(c.vat)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className="mx-auto w-[95px] rounded bg-gray-50 px-1.5 py-1 text-sm text-center font-medium text-gray-900">{fmt(c.total)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button type="button" onClick={() => handleDeleteLine(i)} className="text-xs text-gray-400 hover:text-red-600">
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
          + Add Line
        </button>
      </section>

      <div className="flex flex-wrap gap-4">
        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Purchase Summary</h2>
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

        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Settlement</h2>
          <div className="space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Payment Status</span>
              <span className={paymentStatus === "Paid" ? "font-medium text-green-700" : paymentStatus === "Partially paid" ? "font-medium text-amber-700" : "font-medium text-gray-500"}>{paymentStatus}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Paid Amount</span>
              <span>{fmt(paidTotal)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Outstanding</span>
              <span className="text-base font-bold text-gray-900">{fmt(remaining)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          data-field="pay"
          onClick={() => setShowPayment(true)}
          className="whitespace-nowrap rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5"
        >
          {payments.length > 0 ? "Edit Pay" : "Record Pay"}
        </button>
        <button
          type="button"
          onClick={performSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} disabled={saving} className="rounded text-gray-500 hover:text-gray-700 text-sm px-2 py-1.5 disabled:opacity-50">
            Cancel
          </button>
        )}
      </div>

      {dialog}

      {showSavedDialog && <InfoDialog message="Purchase saved successfully." onOk={() => setShowSavedDialog(false)} />}

      {showPayment && (
        <RecordPayModal
          total={grandTotal}
          cashBankAccounts={cashBankAccounts}
          initialLines={payments}
          saving={false}
          onCancel={() => setShowPayment(false)}
          onConfirm={(p) => {
            setPayments(p);
            setShowPayment(false);
          }}
        />
      )}
    </div>
  );
}
