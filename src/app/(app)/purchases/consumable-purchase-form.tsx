"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createCashPurchaseBatch, type CashBillType } from "./actions";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { RecordPayModal } from "./record-pay-modal";

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
const CELL_TEXT = "text-sm";
const today = () => new Date().toISOString().slice(0, 10);
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

export function ConsumablePurchaseForm({
  vendors,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
}: {
  vendors: Vendor[];
  categoryAccounts: Account[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
}) {
  const router = useRouter();
  const [billDate, setBillDate] = useState(today());
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: MIN_ROWS }, emptyRow));
  const [addCount, setAddCount] = useState("1");
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [paymentRow, setPaymentRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ rowIndex: number; x: number; y: number } | null>(null);
  const [confirmAction, setConfirmAction] = useState<"save" | "reset" | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function close() {
      setContextMenu(null);
    }
    window.addEventListener("click", close);
    window.addEventListener("keydown", (e) => e.key === "Escape" && close());
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

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
    setConfirmAction(null);
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

  function handleSaveClick() {
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
    setConfirmAction("save");
  }

  async function performSave() {
    setConfirmAction(null);
    const validRows = rows.filter(isRowComplete);

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
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2500);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const activeRow = paymentRow !== null ? rows[paymentRow] : null;
  const activeRowTotal = activeRow ? computeRow(activeRow, vatRate).total : 0;

  const grandTotal = rows.reduce((s, r) => s + computeRow(r, vatRate).total, 0);
  const paidByAccount = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.payments) {
      paidByAccount.set(p.accountId, (paidByAccount.get(p.accountId) ?? 0) + p.amount);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Date</label>
        <input
          type="date"
          max={today()}
          value={billDate}
          onChange={(e) => setBillDate(e.target.value)}
          className="w-40 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Description</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Bill no</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Supplier</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Category</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Bill type</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Amount</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-t border-gray-100"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ rowIndex: i, x: e.clientX, y: e.clientY });
                }}
              >
                <td className="px-2 py-1">
                  <input
                    value={row.description}
                    onChange={(e) => updateRow(i, "description", e.target.value)}
                    placeholder="Details"
                    className={`w-36 rounded border border-gray-300 px-2 py-1 ${CELL_TEXT}`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    value={row.billNumber}
                    onChange={(e) => updateRow(i, "billNumber", e.target.value)}
                    className={`w-20 rounded border border-gray-300 px-2 py-1 ${CELL_TEXT}`}
                  />
                </td>
                <td className="px-2 py-1">
                  <select
                    value={row.vendorId}
                    onChange={(e) => updateRow(i, "vendorId", e.target.value)}
                    className={`w-36 rounded border border-gray-300 px-2 py-1 ${CELL_TEXT}`}
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
                <td className="px-2 py-1">
                  <select
                    value={row.categoryId}
                    onChange={(e) => updateRow(i, "categoryId", e.target.value)}
                    className={`w-36 rounded border border-gray-300 px-2 py-1 ${CELL_TEXT}`}
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
                <td className="px-2 py-1">
                  <select
                    value={row.billType}
                    onChange={(e) => updateRow(i, "billType", e.target.value)}
                    className={`w-28 rounded border border-gray-300 px-2 py-1 ${CELL_TEXT}`}
                  >
                    {BILL_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.amount}
                    onChange={(e) => updateRow(i, "amount", e.target.value)}
                    className={`w-24 rounded border border-gray-300 px-2 py-1 ${CELL_TEXT}`}
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => handleRecordPayClick(i)}
                    className="whitespace-nowrap rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs px-3 py-1.5"
                  >
                    {row.payments.length > 0 ? "EDIT PAY" : "RECORD PAY"}
                  </button>
                  {errorRow === i && <p className={`mt-1 w-40 text-red-600 ${CELL_TEXT}`}>Amount is required.</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleAddRows} className="text-sm text-gray-600 hover:text-gray-900">
          + Add rows
        </button>
        <input
          type="number"
          min="1"
          max="100"
          value={addCount}
          onChange={(e) => setAddCount(e.target.value)}
          className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>

      <div className="flex flex-wrap justify-center gap-6">
        <div>
          <h3 className="mb-2 text-base font-medium text-gray-700">Purchase summary</h3>
          <div className="w-64 rounded-lg border border-gray-300 bg-white p-4 space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span>Amount</span>
              <span>{rows.reduce((s, r) => s + computeRow(r, vatRate).amount, 0).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>VAT</span>
              <span>{rows.reduce((s, r) => s + computeRow(r, vatRate).tax, 0).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1 font-medium">
              <span>Grand total</span>
              <span>{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-base font-medium text-gray-700">Settlement summary</h3>
          <div className="w-64 rounded-lg border border-gray-300 bg-white p-4 space-y-2">
            {paidByAccount.size === 0 && <p className="text-sm text-gray-400">—</p>}
            {[...paidByAccount.entries()].map(([accountId, amount]) => (
              <div key={accountId} className="flex items-center justify-between text-sm text-gray-900">
                <span>{accountLabels[accountId] ?? "Account"}</span>
                <span>{amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
              <span className="font-medium text-gray-900">Total</span>
              <span className="font-bold text-gray-900">{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        {savedMessage && <span className="text-xs text-green-600">Saved</span>}
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "SAVE"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmAction("reset")}
          disabled={saving}
          className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5 disabled:opacity-50"
        >
          RESET
        </button>
      </div>

      {confirmAction === "save" && (
        <ConfirmDialog message="Do you want to save?" onYes={performSave} onNo={() => setConfirmAction(null)} />
      )}
      {confirmAction === "reset" && (
        <ConfirmDialog message="Do you want to reset?" onYes={performReset} onNo={() => setConfirmAction(null)} />
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
