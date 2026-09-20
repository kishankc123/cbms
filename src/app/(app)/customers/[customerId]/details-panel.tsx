"use client";

import { useState } from "react";
import { updateCustomer, deleteCustomer } from "../actions";
import { CustomerFormModal } from "../customer-form-modal";

type Customer = { id: string; name: string; panNumber: string; phone: string; details: string; openingBalance: number };

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-gray-900">{value || "—"}</p>
    </div>
  );
}

export function DetailsPanel({
  customer,
  sales,
  paid,
  outstanding,
}: {
  customer: Customer;
  sales: number;
  paid: number;
  outstanding: number;
}) {
  const [deleting, setDeleting] = useState(false);
  const fmt = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const drCr = (n: number) => (n < 0 ? "Cr" : "Dr");

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-3">
        <CustomerFormModal
          title="Edit customer"
          action={updateCustomer}
          customerId={customer.id}
          initial={customer}
          trigger={(open) => (
            <button type="button" onClick={open} className="text-sm text-gray-600 hover:underline">
              Edit
            </button>
          )}
        />
        <form
          action={deleteCustomer}
          onSubmit={(e) => {
            setDeleting(true);
            if (!confirm(`Delete ${customer.name}? This cannot be undone.`)) {
              setDeleting(false);
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="customerId" value={customer.id} />
          <button type="submit" disabled={deleting} className="text-sm text-red-600 hover:underline disabled:opacity-40">
            Delete
          </button>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <Field label="Name" value={customer.name} />
        <Field label="PAN / VAT Number" value={customer.panNumber} />
        <Field label="Contact Number" value={customer.phone} />
        <Field label="Address" value={customer.details} />
        <Field label="Opening Balance" value={`${fmt(customer.openingBalance)} ${drCr(customer.openingBalance)}`} />
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <Field label="Total Sales (all time)" value={fmt(sales)} />
        <Field label="Total Paid (all time)" value={fmt(paid)} />
        <Field label="Outstanding (AR)" value={`${fmt(outstanding)} ${drCr(outstanding)}`} />
      </div>
    </div>
  );
}
