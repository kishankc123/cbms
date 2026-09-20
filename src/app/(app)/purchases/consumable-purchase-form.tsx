"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createCashPurchaseBatch, type CashBillType } from "./actions";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { InfoDialog } from "../inventory/info-dialog";
import { RecordPayModal } from "./record-pay-modal";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number };

type Row = {
  description: string;
  billNumber: string;
  vendorId: string;
  categoryId: string;
  billType: CashBillType;
  amount: string;
  payments: PaymentLine[];
};

export const BILL_TYPE_OPTIONS: { value: CashBillType; label: string }[] = [
  { value: "no_bill", label: "No bill" },
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "estimate", label: "Estimate" },
  { value: "challan", label: "Challan" },
];

const MIN_ROWS = 7;
const fmt = (n: number) => n.toFixed(2);
const today = () => todayIso();
const emptyRow = (): Row => ({
  description: "",
  billNumber: "",
  vendorId: "",
  categoryId: "",
  billType: "no_bill",
  amount: "",
  payments: [],
});

// VAT only applies when the row's bill type is VAT — any other bill type
// books the entered amount as-is, with no tax added.
function computeRow(row: Row, vatRate: number) {
  const amount = parseFloat(row.amount) || 0;
  const tax = row.billType === "vat" ? amount * (vatRate / 100) : 0;
  const total = amount + tax;
  return { amount, tax, total };
}

function isRowTouched(row: Row) {
  return Boolean(
    row.billNumber.trim() || row.vendorId || row.categoryId || row.description.trim() || (parseFloat(row.amount) || 0) > 0
  );
}

function isRowComplete(row: Row) {
  return Boolean(row.categoryId && (parseFloat(row.amount) || 0) > 0 && row.payments.length > 0);
}

function flattenAccounts(groups: CashBankGroup[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const g of groups) {
    if (g.children.length === 0) map[g.id] = g.name;
    else for (const c of g.children) map[c.id] = c.name;
  }
  return map;
}

const cellInputCls =
  "rounded border border-gray-300 bg-white px-1.5 py-1 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const calculatedCellCls = "rounded bg-gray-50 px-1.5 py-1 text-sm text-right text-gray-600";

export function ConsumablePurchaseForm({
  vendors,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  onDirtyChange,
}: {
  vendors: Vendor[];
  categoryAccounts: Account[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [billDate, setBillDate] = useState(today());
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: MIN_ROWS }, emptyRow));
  const [addCount, setAddCount] = useState("1");
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [paymentRow, setPaymentRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSavedDialog, setShowSavedDialog] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ rowIndex: number; x: number; y: number } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!contextMenu) return;
    function close() {
      setContextMenu(null);
    }
    window.addEventListener("click", close);
    window.addEventListener("keydown", (e) => e.key === "Escape" && close());
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    onDirtyChange?.(rows.some(isRowTouched));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const accountLabels = flattenAccounts(cashBankAccounts);

  function updateRow(
    i: number,
    field: "description" | "billNumber" | "vendorId" | "categoryId" | "billType" | "amount",
    value: string
  ) {
    setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  function handleDeleteRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
    setContextMenu(null);
  }

  function handleAddRows() {
    const n = Math.max(1, Math.min(100, parseInt(addCount, 10) || 1));
    setRows((prev) => [...prev, ...Array.from({ length: n }, emptyRow)]);
  }

  function performReset() {
    setRows(Array.from({ length: MIN_ROWS }, emptyRow));
    setSaveError(null);
    setConfirmReset(false);
  }

  function handleRecordPayClick(i: number) {
    const hasAmount = (parseFloat(rows[i].amount) || 0) > 0;
    setErrorRow(hasAmount ? null : i);
    if (!hasAmount) return;
    setPaymentRow(i);
  }

  function handleConfirmPayment(payments: { accountId: string; amount: number }[]) {
    if (paymentRow === null) return;
    setRows((prev) => prev.map((r, idx) => (idx === paymentRow ? { ...r, payments } : r)));
    setPaymentRow(null);
  }

  async function performSave() {
    setSaveError(null);
    const hasIncompleteRow = rows.some((r) => isRowTouched(r) && !isRowComplete(r));
    if (hasIncompleteRow) {
      setSaveError("Some rows are missing required fields — finish or clear them before saving.");
      return;
    }
    const validRows = rows.filter(isRowComplete);
    if (validRows.length === 0) {
      setSaveError("Add at least one purchase row before saving.");
      return;
    }

    setSaving(true);
    try {
      await createCashPurchaseBatch({
        rows: validRows.map((r) => ({
          billNumber: r.billNumber.trim(),
          billDate,
          vendorId: r.vendorId,
          categoryId: r.categoryId,
          billType: r.billType,
          description: r.description,
          amount: parseFloat(r.amount) || 0,
          payments: r.payments,
        })),
      });
      setRows(Array.from({ length: MIN_ROWS }, emptyRow));
      setShowSavedDialog(true);
      onDirtyChange?.(false);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const activeRow = paymentRow !== null ? rows[paymentRow] : null;
  const activeRowTotal = activeRow ? computeRow(activeRow, vatRate).total : 0;

  const completeRows = rows.filter(isRowComplete);
  const computedRows = completeRows.map((r) => computeRow(r, vatRate));
  const totalPurchases = completeRows.length;
  const totalAmount = computedRows.reduce((s, c) => s + c.amount, 0);
  const totalVat = computedRows.reduce((s, c) => s + c.tax, 0);
  const grandTotal = computedRows.reduce((s, c) => s + c.total, 0);
  const paidByAccount = new Map<string, number>();
  for (const r of completeRows) {
    for (const p of r.payments) {
      paidByAccount.set(p.accountId, (paidByAccount.get(p.accountId) ?? 0) + p.amount);
    }
  }
  const totalPaid = completeRows.reduce((s, r) => s + r.payments.reduce((a, p) => a + p.amount, 0), 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Purchase Entries</h2>

        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">Date</label>
          <DatePicker max={today()} value={billDate} onChange={(v) => setBillDate(v)} className="w-40 rounded border border-gray-300 bg-white px-2 py-1 text-sm" />
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Description</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Bill No.</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Supplier</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Category</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Bill Type</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Amount</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">VAT</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Total</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const c = computeRow(row, vatRate);
                return (
                  <tr
                    key={i}
                    className="border-t border-gray-100"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ rowIndex: i, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <td className="px-1 py-1">
                      <input
                        value={row.description}
                        onChange={(e) => updateRow(i, "description", e.target.value)}
                        placeholder="Details"
                        className={`w-36 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={row.billNumber}
                        onChange={(e) => updateRow(i, "billNumber", e.target.value)}
                        className={`w-20 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={row.vendorId}
                        onChange={(e) => updateRow(i, "vendorId", e.target.value)}
                        className={`w-36 ${cellInputCls}`}
                      >
                        <option value="" className="text-gray-400">
                          Select supplier
                        </option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={row.categoryId}
                        onChange={(e) => updateRow(i, "categoryId", e.target.value)}
                        className={`w-36 ${cellInputCls}`}
                      >
                        <option value="" className="text-gray-400">
                          Select category
                        </option>
                        {categoryAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={row.billType}
                        onChange={(e) => updateRow(i, "billType", e.target.value)}
                        className={`w-28 ${cellInputCls}`}
                      >
                        {BILL_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount}
                        onChange={(e) => updateRow(i, "amount", e.target.value)}
                        className={`w-24 text-right ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <div className={`w-20 ${calculatedCellCls}`}>{fmt(c.tax)}</div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="w-24 rounded bg-gray-50 px-1.5 py-1 text-sm text-right font-medium text-gray-900">
                        {fmt(c.total)}
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => handleRecordPayClick(i)}
                        className="whitespace-nowrap rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs px-2.5 py-1"
                      >
                        {row.payments.length > 0 ? "Edit Payment" : "Record Payment"}
                      </button>
                      {errorRow === i && <p className="mt-1 w-40 text-xs text-red-600">Amount is required.</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-gray-500">Rows:</span>
          <input
            type="number"
            min="1"
            max="100"
            value={addCount}
            onChange={(e) => setAddCount(e.target.value)}
            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button type="button" onClick={handleAddRows} className="text-sm text-gray-600 hover:text-gray-900">
            + Add Rows
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-4">
        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Purchase Summary</h2>
          <div className="space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Total Purchases</span>
              <span>{totalPurchases}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Amount</span>
              <span>{fmt(totalAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">VAT</span>
              <span>{fmt(totalVat)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Grand Total</span>
              <span className="text-base font-bold text-gray-900">{fmt(grandTotal)}</span>
            </div>
          </div>
        </section>

        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Settlement Summary</h2>
          <div className="space-y-1 text-sm text-gray-900">
            {paidByAccount.size === 0 && <p className="text-sm text-gray-400">—</p>}
            {[...paidByAccount.entries()].map(([accountId, amount]) => (
              <div key={accountId} className="flex items-center justify-between">
                <span className="text-gray-500">{accountLabels[accountId] ?? "Account"}</span>
                <span>{fmt(amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Paid</span>
              <span className="text-base font-bold text-gray-900">{fmt(totalPaid)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        <button
          type="button"
          onClick={performSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          disabled={saving}
          className="rounded text-gray-500 hover:text-gray-700 text-sm px-2 py-1.5 disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      {confirmReset && (
        <ConfirmDialog
          message="This will clear all entered rows. Continue?"
          onYes={performReset}
          onNo={() => setConfirmReset(false)}
        />
      )}

      {showSavedDialog && (
        <InfoDialog message="Purchase saved successfully." onOk={() => setShowSavedDialog(false)} />
      )}

      {contextMenu && (
        <div
          className="fixed z-50 rounded border border-gray-200 bg-white py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => handleDeleteRow(contextMenu.rowIndex)}
            className="block w-full whitespace-nowrap px-4 py-1.5 text-left text-sm text-red-600 hover:bg-gray-50"
          >
            Delete this row
          </button>
        </div>
      )}

      {paymentRow !== null && activeRow && (
        <RecordPayModal
          total={activeRowTotal}
          cashBankAccounts={cashBankAccounts}
          initialLines={activeRow.payments}
          saving={false}
          onCancel={() => setPaymentRow(null)}
          onConfirm={handleConfirmPayment}
        />
      )}
    </div>
  );
}
