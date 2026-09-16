"use client";

import { useState } from "react";
import { createInvoice } from "./actions";

type Customer = { id: string; name: string };
type Account = { id: string; code: string; name: string };

const EMPTY_ITEM = { description: "", quantity: "1", unitPrice: "", taxRate: "0" };

export function InvoiceForm({
  customers,
  incomeAccounts,
}: {
  customers: Customer[];
  incomeAccounts: Account[];
}) {
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);

  function updateItem(i: number, field: keyof typeof EMPTY_ITEM, value: string) {
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  const subtotal = items.reduce(
    (s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0),
    0
  );
  const tax = items.reduce(
    (s, it) =>
      s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0) * ((parseFloat(it.taxRate) || 0) / 100),
    0
  );
  const total = subtotal + tax;

  return (
    <form action={createInvoice} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Customer</label>
          <select name="customerId" required className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[180px]">
            <option value="">Select customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Invoice date</label>
          <input
            type="date"
            name="invoiceDate"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Due date</label>
          <input type="date" name="dueDate" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Revenue account</label>
          <select
            name="revenueAccountId"
            required
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[180px]"
          >
            <option value="">Select account</option>
            {incomeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="pb-1 font-medium">Description</th>
            <th className="pb-1 font-medium w-20">Qty</th>
            <th className="pb-1 font-medium w-28">Unit price</th>
            <th className="pb-1 font-medium w-24">Tax %</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <input
                  name="itemDescription"
                  value={row.description}
                  onChange={(e) => updateItem(i, "description", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  name="itemQuantity"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.quantity}
                  onChange={(e) => updateItem(i, "quantity", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  name="itemUnitPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.unitPrice}
                  onChange={(e) => updateItem(i, "unitPrice", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </td>
              <td className="py-1">
                <input
                  name="itemTaxRate"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.taxRate}
                  onChange={(e) => updateItem(i, "taxRate", e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          + Add line
        </button>
        <div className="text-sm text-gray-600">
          Subtotal {subtotal.toFixed(2)} · Tax {tax.toFixed(2)} ·{" "}
          <span className="font-medium text-gray-900">Total {total.toFixed(2)}</span>
        </div>
      </div>

      <button
        type="submit"
        className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
      >
        Create invoice
      </button>
    </form>
  );
}
