"use client";

import { useState } from "react";
import { updateSupplier, deleteSupplier } from "../actions";
import { SupplierFormModal } from "../supplier-form-modal";

type Supplier = { id: string; name: string; phone: string; details: string; openingBalance: number };

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-gray-900">{value || "—"}</p>
    </div>
  );
}

export function DetailsPanel({
  supplier,
  purchases,
  paid,
  outstanding,
}: {
  supplier: Supplier;
  purchases: number;
  paid: number;
  outstanding: number;
}) {
  const [deleting, setDeleting] = useState(false);
  const fmt = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 });
  // Accounts Payable is a liability — a positive balance (money we owe) is a
  // normal credit balance, the opposite of the customer/AR side.
  const drCr = (n: number) => (n < 0 ? "Dr" : "Cr");

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-3">
        <SupplierFormModal
          title="Edit supplier"
          action={updateSupplier}
          supplierId={supplier.id}
          initial={supplier}
          trigger={(open) => (
            <button type="button" onClick={open} className="text-sm text-gray-600 hover:underline">
              Edit
            </button>
          )}
        />
        <form
          action={deleteSupplier}
          onSubmit={(e) => {
            setDeleting(true);
            if (!confirm(`Delete ${supplier.name}? This cannot be undone.`)) {
              setDeleting(false);
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="supplierId" value={supplier.id} />
          <button type="submit" disabled={deleting} className="text-sm text-red-600 hover:underline disabled:opacity-40">
            Delete
          </button>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <Field label="Name" value={supplier.name} />
        <Field label="Contact Number" value={supplier.phone} />
        <Field label="Address" value={supplier.details} />
        <Field label="Opening Balance" value={`${fmt(supplier.openingBalance)} ${drCr(supplier.openingBalance)}`} />
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <Field label="Total Purchases (all time)" value={fmt(purchases)} />
        <Field label="Total Paid (all time)" value={fmt(paid)} />
        <Field label="Outstanding (AP)" value={`${fmt(outstanding)} ${drCr(outstanding)}`} />
      </div>
    </div>
  );
}
